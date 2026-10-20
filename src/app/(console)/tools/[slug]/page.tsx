"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { JobProgress } from "@/components/workbench/JobProgress";
import { ResultView } from "@/components/workbench/ResultView";
import { ToolForm } from "@/components/workbench/ToolForm";
import {
  useCancelJob,
  useCreateJob,
  useJob,
  useJobList,
  useTools,
} from "@/lib/client/api";

export default function ToolPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const router = useRouter();

  const { data: toolsData, isLoading } = useTools();
  const tool = toolsData?.tools.find((t) => t.slug === slug);

  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const create = useCreateJob();
  const cancel = useCancelJob();
  const { data: jobData } = useJob(jobId);
  const { data: history } = useJobList({ tool: slug, limit: 8 });

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

  const submit = async (values: Record<string, unknown>, modelKey: string | null) => {
    if (!tool) return;
    setNotice(null);
    try {
      const created = await create.mutateAsync({ tool: tool.slug, input: values, modelKey });
      setJobId(created.id);
    } catch (e) {
      setNotice((e as Error).message);
    }
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
              <span className="chip">{tool.etaSeconds}s</span>
              <span className="chip">{tool.creditCost} 积分</span>
            </div>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--t2)" }}>
              {tool.tagline}
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className="rounded-[9px] border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: "color-mix(in srgb, var(--rose) 40%, transparent)",
            background: "var(--rose-soft)",
            color: "var(--rose)",
          }}
          role="alert"
        >
          {notice}
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
          <ToolForm tool={tool} busy={create.isPending} onSubmit={submit} />
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
              <span className="flex justify-between">
                <span>预计耗时</span>
                <span className="mono" style={{ color: "var(--t2)" }}>{tool.etaSeconds}s</span>
              </span>
              <span className="flex justify-between">
                <span>积分</span>
                <span className="mono" style={{ color: "var(--t2)" }}>{tool.creditCost}</span>
              </span>
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
                    onClick={() => setJobId(h.id)}
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
                    <span className="mono min-w-0 flex-1 truncate text-[10.5px]" style={{ color: "var(--t3)" }}>
                      {new Date(h.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    <span className="mono text-[10px]" style={{ color: h.id === jobId ? "var(--gold)" : "var(--t3)" }}>
                      {h.status === "succeeded" ? "查看" : h.status}
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
