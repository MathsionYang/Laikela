"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { baseCredits } from "@/lib/domain/pricing";
import { mergeInput, type ToolDef } from "@/lib/domain/tools";
import { JobProgress } from "@/components/workbench/JobProgress";
import { ResultView } from "@/components/workbench/ResultView";
import { ToolForm } from "@/components/workbench/ToolForm";
import {
  useCancelJob,
  useCreateJob,
  useJob,
  useJobList,
  useTools,
  type ClientAsset,
  type ClientJob,
} from "@/lib/client/api";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/**
 * 把历史任务 input 里的上传字段（素材 id 列表）还原成可展示的文件。
 * 素材可能已被删除 —— 删掉的不静默忽略，交给调用方提示「请重新上传」，
 * 否则用户会带着一个不存在的 asset id 提交，任务跑到一半才报错。
 */
async function loadUploads(
  tool: ToolDef,
  input: Record<string, unknown>,
): Promise<{ uploads: Record<string, ClientAsset[]>; missing: string[] }> {
  const uploads: Record<string, ClientAsset[]> = {};
  const missing: string[] = [];

  await Promise.all(
    tool.fields
      .filter((f) => f.type === "upload")
      .map(async (f) => {
        const ids = String(input[f.id] ?? "")
          .split(",")
          .filter(Boolean);
        if (!ids.length) return;
        const got = await Promise.all(
          ids.map(async (id) => {
            try {
              const res = await fetch(`/api/assets/${id}`);
              if (!res.ok) return null;
              const json = (await res.json()) as { data?: ClientAsset };
              return json.data ?? null;
            } catch {
              return null;
            }
          }),
        );
        const alive = got.filter((x): x is ClientAsset => Boolean(x));
        if (alive.length < ids.length) missing.push(f.label);
        if (alive.length) uploads[f.id] = alive;
      }),
  );

  return { uploads, missing };
}

export default function ToolPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const router = useRouter();

  const { data: toolsData, isLoading } = useTools();
  const tool = toolsData?.tools.find((t) => t.slug === slug);

  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const create = useCreateJob();
  const cancel = useCancelJob();
  const { data: jobData } = useJob(jobId);
  const { data: history } = useJobList({ tool: slug, limit: 8 });

  /**
   * 历史版本回填。
   *   seed        —— 要灌进表单的参数（null = 空白表单）
   *   formKey     —— 变化即重建 ToolForm，这是最干净的重置方式（无需同步副作用）
   *   seedFrom    —— 当前表单内容来自哪条任务；null 表示是用户自己从空白填的
   *   parentNext  —— 下次提交要挂的 parent_job_id
   *   dirty       —— 用户是否在当前表单上改动过（未提交）
   */
  const [seed, setSeed] = useState<{
    values: Record<string, unknown>;
    modelKey: string | null;
    uploads: Record<string, ClientAsset[]>;
  } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [seedFrom, setSeedFrom] = useState<string | null>(null);
  const [seedFromAt, setSeedFromAt] = useState<string | null>(null);
  const [parentNext, setParentNext] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // SSE：进度实时推进（轮询仍在，作为断线兜底）
  const [live, setLive] = useState<{ status: string; stage: string; progress: number } | null>(
    null,
  );

  useEffect(() => {
    setLive(null);
    if (!jobId) return;
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    const onProgress = (e: MessageEvent) => {
      try {
        setLive(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("progress", onProgress as EventListener);
    es.addEventListener("done", () => es.close());
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);

  const job = jobData?.job;
  const assets = jobData?.assets ?? [];

  const running = job
    ? ["queued", "running", "post_processing", "reviewing"].includes(job.status)
    : false;

  /**
   * 提交 = 建新任务。若本次参数来自历史版本（parentNext 非空），
   * 新任务挂 parent_job_id，只做溯源；原任务的状态与产出完全不被动。
   */
  const submit = async (values: Record<string, unknown>, modelKey: string | null) => {
    if (!tool) return;
    setNotice(null);
    const from = parentNext;
    try {
      const created = await create.mutateAsync({
        tool: tool.slug,
        input: values,
        modelKey,
        parentJobId: from,
      });
      setJobId(created.id);
      // 链式：再改一版时，新任务挂在「刚生成的这条」下，形成可追溯的修改链
      setParentNext(created.id);
      setDirty(false);
      if (from) {
        setNotice({
          kind: "info",
          text: `已按修改后的参数重新提交，新任务 ${created.id} 在队列中。原任务 ${from} 的记录与产出保持不变。`,
        });
      }
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };

  /**
   * 点历史条目：切预览 + 回填参数。
   * 幂等与草稿保护都在这里：同一版本连点不重复覆盖；有未提交改动时先问一句。
   */
  const loadFromHistory = async (h: ClientJob) => {
    setJobId(h.id);
    if (!tool) return;

    if (!h.input || Object.keys(h.input).length === 0) {
      setNotice({ kind: "error", text: "这条任务没有保存输入参数，只能查看产出。" });
      return;
    }
    // 已经是这条的参数且没改过 —— 不必重灌，免得把光标和滚动位置打乱
    if (seedFrom === h.id && !dirty) return;

    if (dirty && !window.confirm("当前配置有未提交的修改，载入这条历史版本会覆盖它。继续？")) {
      return;
    }

    const { values, dropped } = mergeInput(tool, h.input);
    const { uploads, missing } = await loadUploads(tool, h.input);

    setSeed({ values, modelKey: h.modelKey ?? null, uploads });
    setFormKey((k) => k + 1);
    setSeedFrom(h.id);
    setSeedFromAt(h.createdAt);
    setParentNext(h.id);
    setDirty(false);

    const notes: string[] = [];
    if (dropped.length) notes.push(`${dropped.join("、")} 在当前版本已不可用，已回落默认值`);
    if (missing.length) notes.push(`原上传文件已失效（${missing.join("、")}），请重新上传`);
    setNotice({
      kind: "info",
      text: notes.length
        ? `已载入 ${fmtTime(h.createdAt)} 的参数：${notes.join("；")}`
        : `已载入 ${fmtTime(h.createdAt)} 那次提交的参数，可直接查看或修改后重新生成`,
    });
  };

  /** 清掉回填，回到工具的空白默认值 */
  const resetForm = () => {
    setSeed(null);
    setFormKey((k) => k + 1);
    setSeedFrom(null);
    setSeedFromAt(null);
    setParentNext(null);
    setDirty(false);
    setNotice(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="skeleton h-16 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="skeleton h-[420px]" />
          <div className="skeleton h-[420px]" />
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <h1 className="serif text-[22px]">没有这个工具</h1>
        <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
          工具可能已下线，或者链接过期。
        </p>
        <Link href="/tools" className="btn btn-ghost btn-sm">
          <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />
          返回能力目录
        </Link>
      </div>
    );
  }

  // 积分与耗时来自服务端报价（= 这一单真正会扣的分 / 实测中位耗时）
  const quote = tool.quote;
  const credits = quote?.credits ?? baseCredits(tool);
  const eta = quote?.etaSeconds ?? tool.etaBaseline;
  const priceTitle = quote
    ? `按 ${quote.units} ${unitWord(tool.kind)}计费 · ${quote.modelLabel}${
        quote.maxCredits > quote.minCredits
          ? ` · 换模型区间 ${quote.minCredits}–${quote.maxCredits} 积分`
          : ""
      }`
    : "当前无可用模型，按本地引擎估算";
  const etaTitle =
    quote && quote.etaSource === "measured"
      ? `近 ${quote.etaSamples} 次实测中位耗时`
      : "暂无实测样本，按基线估算";

  return (
    <div className="flex flex-col gap-4">
      {/* 头部 */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => router.push("/tools")}
          className="flex w-fit items-center gap-1.5 text-[11.5px]"
          style={{ color: "var(--t3)" }}
        >
          <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />
          能力目录
        </button>

        <div className="flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px]"
            style={{ background: "var(--gold-soft)", color: "var(--gold)", boxShadow: "inset 0 0 0 1px var(--gold-line)" }}
          >
            <Icon name={tool.icon} size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="serif text-[22px] leading-tight sm:text-[26px]">{tool.name}</h1>
              {tool.badge === "new" && <span className="chip chip-new">NEW</span>}
              {tool.badge === "hot" && <span className="chip chip-hot">HOT</span>}
              <span className="chip" title={etaTitle}>
                ≈{eta}s
              </span>
              <span className="chip" title={priceTitle}>
                {credits} 积分
              </span>
            </div>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--t2)" }}>
              {tool.tagline}
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className="rounded-[9px] border px-3 py-2 text-[11.5px] leading-relaxed"
          style={
            notice.kind === "error"
              ? {
                  borderColor: "color-mix(in srgb, var(--rose) 40%, transparent)",
                  background: "var(--rose-soft)",
                  color: "var(--rose)",
                }
              : {
                  borderColor: "color-mix(in srgb, var(--jade) 35%, transparent)",
                  background: "var(--jade-soft)",
                  color: "var(--jade)",
                }
          }
          role="alert"
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)_250px]">
        {/* 左：配置 */}
        <section className="card p-4 lg:sticky lg:top-[calc(var(--shell-top)+16px)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="serif text-[14px]">生成配置</h2>
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {tool.fields.filter((f) => f.required).length} 个必填
            </span>
          </div>

          {seedFrom && (
            <div
              className="mb-3 flex items-start justify-between gap-2 rounded-[8px] px-2.5 py-2"
              style={{
                background: "var(--gold-soft)",
                boxShadow: "inset 0 0 0 1px var(--gold-line)",
              }}
            >
              <span className="text-[10.5px] leading-relaxed" style={{ color: "var(--gold)" }}>
                参数来自 {fmtTime(seedFromAt ?? new Date().toISOString())} 的版本
                <span className="block" style={{ color: "var(--t3)" }}>
                  改完点生成会新建一条任务，原来那条不动
                </span>
              </span>
              <button
                type="button"
                onClick={resetForm}
                className="shrink-0 text-[10.5px] underline"
                style={{ color: "var(--t3)" }}
              >
                恢复默认
              </button>
            </div>
          )}

          <ToolForm
            key={formKey}
            tool={tool}
            busy={create.isPending}
            onSubmit={submit}
            initialValues={seed?.values ?? null}
            initialModelKey={seed?.modelKey ?? null}
            initialUploads={seed?.uploads}
            onDirtyChange={setDirty}
          />
        </section>

        {/* 中：预览 */}
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="serif text-[14px]">产出预览</h2>
            {job && (
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                {new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            )}
          </div>

          {!jobId && <EmptyState outcome={tool.outcome} />}

          {jobId && running && (
            <JobProgress
              status={live?.status ?? job?.status ?? "queued"}
              stage={live?.stage ?? job?.stage ?? "排队中"}
              progress={live?.progress ?? job?.progress ?? 0}
              onCancel={() => jobId && cancel.mutate(jobId)}
            />
          )}

          {jobId && job?.status === "failed" && (
            <div className="flex flex-col gap-3 py-6">
              <div className="flex items-center gap-2" style={{ color: "var(--rose)" }}>
                <Icon name="alert" size={16} />
                <span className="text-[13px]">生成失败</span>
              </div>
              <p className="text-[11.5px]" style={{ color: "var(--t2)" }}>
                {job.error?.message ?? "未知错误"}
                {job.error?.code && (
                  <span className="mono ml-2 text-[10px]" style={{ color: "var(--t3)" }}>
                    {job.error.code}
                  </span>
                )}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm w-fit"
                onClick={() => setJobId(null)}
              >
                <Icon name="refresh" size={12} /> 调整输入后重试
              </button>
            </div>
          )}

          {jobId && job?.status === "canceled" && (
            <div className="py-8 text-center text-[12px]" style={{ color: "var(--t3)" }}>
              任务已取消。
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setJobId(null)}
              >
                重新开始
              </button>
            </div>
          )}

          {jobId && job?.status === "succeeded" && (
            <ResultView job={job} assets={assets} onRetry={() => setJobId(null)} />
          )}
        </section>

        {/* 右：说明与历史（移动端在下方） */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-[calc(var(--shell-top)+16px)]">
          <section className="card p-4">
            <div className="eyebrow mb-2">OUTPUT</div>
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
              {tool.outcome}
            </p>
            <div
              className="mt-3 flex flex-col gap-1.5 border-t pt-2.5 text-[10.5px]"
              style={{ borderColor: "var(--line)", color: "var(--t3)" }}
            >
              <span className="flex justify-between">
                <span>类型</span>
                <span className="mono" style={{ color: "var(--t2)" }}>{tool.kind}</span>
              </span>
              <span className="flex justify-between gap-2">
                <span>预计耗时</span>
                <span className="mono text-right" style={{ color: "var(--t2)" }}>
                  ≈{eta}s
                  <span className="ml-1" style={{ color: "var(--t3)" }}>
                    {quote?.etaSource === "measured" ? `实测 ${quote.etaSamples} 次` : "基线"}
                  </span>
                </span>
              </span>
              <span className="flex justify-between gap-2">
                <span>积分</span>
                <span className="mono text-right" style={{ color: "var(--t2)" }}>
                  {credits}
                  <span className="ml-1" style={{ color: "var(--t3)" }}>
                    {quote ? quote.modelLabel : "本地引擎"}
                  </span>
                </span>
              </span>
              {tool.billingNote && (
                <span className="flex justify-between gap-2">
                  <span>计费方式</span>
                  <span className="text-right" style={{ color: "var(--t2)" }}>
                    {tool.billingNote}
                  </span>
                </span>
              )}
            </div>
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="serif text-[13.5px]">历史版本</h2>
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                {history?.length ?? 0}
              </span>
            </div>
            <ul className="flex flex-col">
              {(history ?? []).length === 0 && (
                <li className="py-3 text-[11px]" style={{ color: "var(--t3)" }}>
                  还没有生成记录
                </li>
              )}
              {(history ?? []).map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => void loadFromHistory(h)}
                    className="flex w-full items-center gap-2 border-b py-2 text-left last:border-0"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span
                      className={`dot ${
                        h.status === "succeeded"
                          ? "dot-ok"
                          : h.status === "failed"
                            ? "dot-fail"
                            : "dot-queued"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="mono block truncate text-[10.5px]"
                        style={{ color: "var(--t3)" }}
                      >
                        {fmtTime(h.createdAt)}
                      </span>
                      <span className="block truncate text-[10px]" style={{ color: "var(--t2)" }}>
                        {inputSummary(tool, h.input)}
                      </span>
                    </span>
                    <span
                      className="mono shrink-0 text-[10px]"
                      style={{ color: seedFrom === h.id ? "var(--gold)" : "var(--t3)" }}
                    >
                      {seedFrom === h.id
                        ? "已载入"
                        : h.status === "succeeded"
                          ? "查看"
                          : h.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ outcome }: { outcome: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span
        className="grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--surface-2)", color: "var(--t3)" }}
      >
        <Icon name="spark" size={20} />
      </span>
      <div>
        <p className="text-[12.5px]" style={{ color: "var(--t2)" }}>
          填好左侧配置，点「生成」
        </p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--t3)" }}>
          产出：{outcome}
        </p>
      </div>
    </div>
  );
}

/** 计费单位的中文说法，与 lib/domain/pricing.ts 的计费量口径对应 */
function unitWord(kind: string): string {
  if (kind === "image") return "张";
  if (kind === "video") return "秒";
  if (kind === "audio") return "千字符";
  return "千 token";
}

/**
 * 历史列表里的一行摘要。只有时间的话，用户根本分不出哪条是自己要的那个版本；
 * 取第一个有值的文本字段，比列出全部参数省地方。
 */
function inputSummary(tool: ToolDef, input: Record<string, unknown> | null | undefined): string {
  if (!input) return "（这条没有保存参数）";
  for (const f of tool.fields) {
    const v = String(input[f.id] ?? "").trim();
    if (!v) continue;
    if (f.type === "upload") return `${f.label}：${v.split(",").filter(Boolean).length} 个文件`;
    return v.length > 26 ? `${v.slice(0, 26)}…` : v;
  }
  return "（这条没有保存参数）";
}
