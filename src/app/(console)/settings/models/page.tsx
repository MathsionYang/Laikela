"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  useModels,
  useSaveKey,
  useDeleteKey,
  useToggleModel,
  useCreateEndpoint,
  useToggleEndpoint,
  useDeleteEndpoint,
  useTestEndpoint,
  type CredentialPayload,
  type EndpointPayload,
  type ModelPayload,
  type ModelsPayload,
} from "@/lib/client/api";

const KIND_LABEL: Record<ModelPayload["kind"], string> = {
  text: "文本",
  image: "图像",
  video: "视频",
  audio: "语音",
};

const KIND_ORDER: ModelPayload["kind"][] = ["text", "image", "video", "audio"];

const PROTOCOL_LABEL: Record<string, string> = {
  "openai-chat": "POST /chat/completions",
  "ark-image": "POST /images/generations",
  "ark-video": "POST /contents/generations/tasks",
  "ark-tts": "POST /audio/speech",
  local: "进程内调用",
};

const PROVIDERS: Array<{ id: "deepseek" | "doubao" | "bailian"; name: string; hint: string }> = [
  { id: "deepseek", name: "DeepSeek", hint: "以 sk- 开头，在 platform.deepseek.com 创建" },
  { id: "doubao", name: "豆包 · 火山方舟", hint: "方舟控制台的 API Key，同时驱动文本 / 图像 / 视频 / 语音" },
  { id: "bailian", name: "阿里百炼", hint: "百炼控制台的 sk- 开头 Key；本网关实测支持文本与出图，语音未开放" },
];

export default function ModelsPage() {
  const { data, isLoading, error } = useModels();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-2">MODEL GATEWAY</div>
          <h1 className="serif text-[26px] leading-tight sm:text-[30px]">模型接入</h1>
          <p className="mt-1.5 max-w-[620px] text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
            内置目录决定「有哪些模型」，套餐决定「能用哪些」，凭证决定「谁付钱」。
            平台 Key 由我们代付；填了自己的 Key 就优先用你的，只收 1 点平台服务费。
          </p>
        </div>
        {data && (
          <span className="chip" title="当前生效套餐">
            当前套餐 · {PLAN_NAME[data.planCode] ?? data.planCode}
          </span>
        )}
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[11.5px]"
          style={{
            borderColor:
              notice.tone === "ok" ? "var(--gold-line)" : "color-mix(in srgb, var(--rose) 40%, transparent)",
            background: notice.tone === "ok" ? "var(--gold-soft)" : "var(--rose-soft)",
            color: notice.tone === "ok" ? "var(--gold)" : "var(--rose)",
          }}
        >
          <Icon name={notice.tone === "ok" ? "check" : "alert"} size={13} />
          {notice.text}
        </div>
      )}

      {isLoading && <div className="skeleton h-[300px] w-full" />}
      {error && (
        <div className="card p-4 text-[12px]" style={{ color: "var(--rose)" }}>
          加载失败：{(error as Error).message}
        </div>
      )}

      {data && (
        <>
          <KeySection data={data} onNotice={setNotice} />
          <EndpointSection data={data} onNotice={setNotice} />
          <CatalogSection data={data} onNotice={setNotice} />
          <HowItWorks data={data} />
        </>
      )}
    </div>
  );
}

const PLAN_NAME: Record<string, string> = {
  free: "体验版",
  creator: "创作版",
  studio: "工作室",
  enterprise: "企业版",
};

/* --------------------------- BYOK：自带 API Key --------------------------- */

function KeySection({
  data,
  onNotice,
}: {
  data: ModelsPayload;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  return (
    <section className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">BRING YOUR OWN KEY</div>
          <h2 className="serif mt-1 text-[16px]">供应商凭证</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
            Key 加密后存库（AES-256-GCM），前端只显示前 4 位与后 4 位。填了就走你的额度，费用由供应商直接结算。
          </p>
        </div>
        {!data.canManageKeys && (
          <span className="chip" style={{ color: "var(--rose)" }}>
            只读 · 需管理员权限
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {PROVIDERS.map((p) => (
          <KeyCard
            key={p.id}
            provider={p}
            credential={data.credentials.find((c) => c.provider === p.id) ?? null}
            platformReady={data.models.some(
              (m) => m.provider === p.id && m.keySource === "platform" && m.available,
            )}
            canManage={data.canManageKeys}
            onNotice={onNotice}
          />
        ))}
      </div>
    </section>
  );
}

function KeyCard({
  provider,
  credential,
  platformReady,
  canManage,
  onNotice,
}: {
  provider: { id: "deepseek" | "doubao" | "bailian"; name: string; hint: string };
  credential: CredentialPayload | null;
  platformReady: boolean;
  canManage: boolean;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  const save = useSaveKey();
  const remove = useDeleteKey();
  const [value, setValue] = useState("");

  const byok = Boolean(credential?.configured);

  const state = byok
    ? { text: "使用你的 Key", color: "var(--jade)" }
    : platformReady
      ? { text: "使用平台 Key", color: "var(--gold)" }
      : { text: "未配置 · 仅本地模型可用", color: "var(--t3)" };

  const submit = async () => {
    if (!value.trim()) return;
    try {
      const res = await save.mutateAsync({ provider: provider.id, apiKey: value.trim() });
      setValue("");
      onNotice({ tone: "ok", text: `${provider.name} 已保存（${res.credential.keyHint}）` });
    } catch (e) {
      onNotice({ tone: "err", text: (e as Error).message });
    }
  };

  const clear = async () => {
    try {
      await remove.mutateAsync(provider.id);
      onNotice({ tone: "ok", text: `${provider.name} 的 Key 已删除，回落到平台 Key` });
    } catch (e) {
      onNotice({ tone: "err", text: (e as Error).message });
    }
  };

  return (
    <div
      className="rounded-[10px] border p-3.5"
      style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <b className="text-[13px]">{provider.name}</b>
        <span className="mono text-[10px]" style={{ color: state.color }}>
          {state.text}
        </span>
      </div>

      <div className="mono mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--t3)" }}>
        {byok ? (
          <>
            <span style={{ color: "var(--t2)" }}>{credential?.keyHint}</span>
            <span>· {credential?.lastUsedAt ? "最近调用过" : "尚未调用"}</span>
            {credential?.status === "error" && (
              <span style={{ color: "var(--rose)" }}>· 上次调用失败</span>
            )}
          </>
        ) : (
          <span>{provider.hint}</span>
        )}
      </div>

      {credential?.lastError && (
        <p className="mt-1.5 line-clamp-2 text-[10.5px]" style={{ color: "var(--rose)" }}>
          {credential.lastError}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="input flex-1"
          type="password"
          autoComplete="off"
          placeholder={byok ? "粘贴新 Key 可覆盖" : "粘贴 API Key"}
          value={value}
          disabled={!canManage || save.isPending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canManage || !value.trim() || save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
          {byok && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={!canManage || remove.isPending}
              onClick={() => void clear()}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------- 自定义端点：任意 OpenAI 兼容服务 ------------------- */

const PRESETS: Array<{ name: string; baseUrl: string; model: string }> = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
  { name: "Ollama 本地", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
];

function EndpointSection({
  data,
  onNotice,
}: {
  data: ModelsPayload;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  const create = useCreateEndpoint();
  const test = useTestEndpoint();
  const [form, setForm] = useState({
    name: "",
    kind: "text" as "text" | "image",
    baseUrl: "",
    modelName: "",
    apiKey: "",
    credits: 1,
  });
  const [tested, setTested] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string | number) =>
    setForm((prev) => ({ ...prev, [k]: v }) as typeof form);

  const runTest = async () => {
    setTested(null);
    try {
      const r = await test.mutateAsync({
        baseUrl: form.baseUrl,
        modelName: form.modelName,
        apiKey: form.apiKey,
      });
      if (r.ok) {
        setTested(`连通 · ${r.latencyMs}ms · 返回「${r.sample ?? ""}」`);
      } else {
        setTested(`失败：${r.error ?? "未知"}${r.hint ? ` —— ${r.hint}` : ""}`);
      }
    } catch (e) {
      setTested((e as Error).message);
    }
  };

  const submit = async () => {
    try {
      const r = await create.mutateAsync({
        name: form.name,
        kind: form.kind,
        baseUrl: form.baseUrl,
        modelName: form.modelName,
        apiKey: form.apiKey,
        credits: form.credits,
      });
      setForm({ name: "", kind: "text", baseUrl: "", modelName: "", apiKey: "", credits: 1 });
      setTested(null);
      onNotice({ tone: "ok", text: `已接入「${r.endpoint.name}」，可以在生成页直接选用` });
    } catch (e) {
      onNotice({ tone: "err", text: (e as Error).message });
    }
  };

  const ready = form.name.trim() && form.baseUrl.trim() && form.modelName.trim() && form.apiKey.trim();

  return (
    <section className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">CUSTOM ENDPOINT · OPENAI COMPATIBLE</div>
          <h2 className="serif mt-1 text-[16px]">接入任意兼容模型</h2>
          <p className="mt-1 max-w-[600px] text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
            只要服务实现 <code className="mono">POST /chat/completions</code>，填 URL、模型名、Key
            就能用 —— OpenAI、DeepSeek、硅基流动、月之暗面、vLLM、Ollama、各类中转站都行。
            出图类服务按 <code className="mono">/images/generations</code> 接入。
          </p>
        </div>
        <span className="chip">{data.endpoints.length} 个已接入</span>
      </div>

      {/* 已接入列表 */}
      {data.endpoints.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {data.endpoints.map((ep) => (
            <EndpointRow key={ep.id} ep={ep} canManage={data.canManageKeys} onNotice={onNotice} />
          ))}
        </div>
      )}

      {/* 新增表单 */}
      {data.canManageKeys && (
        <div
          className="mt-4 rounded-[10px] border p-3.5"
          style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              快速填入
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="chip"
                style={{ fontSize: 10, cursor: "pointer" }}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    name: prev.name || p.name,
                    baseUrl: p.baseUrl,
                    modelName: p.model,
                  }))
                }
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="field">
              <label className="field-label" htmlFor="ep-name">显示名称</label>
              <input
                id="ep-name"
                className="input"
                placeholder="例如 自建 Qwen 网关"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ep-kind">类型</label>
              <select
                id="ep-kind"
                className="select"
                value={form.kind}
                onChange={(e) => set("kind", e.target.value)}
              >
                <option value="text">文本（/chat/completions）</option>
                <option value="image">图像（/images/generations）</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ep-url">Base URL</label>
              <input
                id="ep-url"
                className="input"
                placeholder="https://api.example.com/v1"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
              />
              <span className="text-[10px]" style={{ color: "var(--t3)" }}>
                多数服务要带 <code className="mono">/v1</code>；末尾不要写 /chat/completions
              </span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ep-model">模型名称</label>
              <input
                id="ep-model"
                className="input"
                placeholder="deepseek-chat / Qwen/Qwen2.5-72B-Instruct"
                value={form.modelName}
                onChange={(e) => set("modelName", e.target.value)}
              />
            </div>
            <div className="field sm:col-span-2">
              <label className="field-label" htmlFor="ep-key">API Key</label>
              <input
                id="ep-key"
                className="input"
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </div>
          </div>

          {tested && (
            <p
              className="mt-2 text-[10.5px] leading-relaxed"
              style={{ color: tested.startsWith("连通") ? "var(--jade)" : "var(--rose)" }}
            >
              {tested}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!form.baseUrl || !form.modelName || !form.apiKey || test.isPending}
              onClick={() => void runTest()}
            >
              <Icon name="spark" size={12} />
              {test.isPending ? "测试中…" : "测试连接"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!ready || create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? "保存中…" : "接入"}
            </button>
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              Key 加密存库，按「自带 Key」计费：每次任务 1 点平台服务费
            </span>
          </div>
        </div>
      )}

      {!data.canManageKeys && data.endpoints.length === 0 && (
        <p className="mt-3 text-[11px]" style={{ color: "var(--t3)" }}>
          当前账号没有接入权限，需要空间管理员操作。
        </p>
      )}
    </section>
  );
}

function EndpointRow({
  ep,
  canManage,
  onNotice,
}: {
  ep: EndpointPayload;
  canManage: boolean;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  const test = useTestEndpoint();
  const toggle = useToggleEndpoint();
  const remove = useDeleteEndpoint();
  const [result, setResult] = useState<string | null>(null);

  const runTest = async () => {
    setResult("测试中…");
    try {
      const r = await test.mutateAsync({ id: ep.id });
      setResult(r.ok ? `连通 · ${r.latencyMs}ms` : `失败：${r.error ?? ""}`);
    } catch (e) {
      setResult((e as Error).message);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[9px] border px-3 py-2"
      style={{ borderColor: "var(--line)", opacity: ep.enabled ? 1 : 0.65 }}
    >
      <span
        className="h-[6px] w-[6px] rounded-full"
        style={{ background: ep.enabled ? "var(--jade)" : "var(--t3)" }}
        aria-hidden="true"
      />
      <b className="text-[12px]">{ep.name}</b>
      <span className="chip" style={{ fontSize: 10 }}>
        {ep.kind === "image" ? "图像" : "文本"}
      </span>
      <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
        {ep.baseUrl} · {ep.modelName} · {ep.keyHint}
      </span>
      {result && (
        <span
          className="mono text-[10px]"
          style={{ color: result.startsWith("连通") ? "var(--jade)" : "var(--rose)" }}
        >
          {result}
        </span>
      )}
      {ep.lastError && !result && (
        <span className="mono text-[10px]" style={{ color: "var(--rose)" }}>
          {ep.lastError.slice(0, 40)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void runTest()} disabled={test.isPending}>
          测试
        </button>
        {canManage && (
          <>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={toggle.isPending}
              onClick={() => {
                void toggle
                  .mutateAsync({ id: ep.id, enabled: !ep.enabled })
                  .catch((e: Error) => onNotice({ tone: "err", text: e.message }));
              }}
            >
              {ep.enabled ? "停用" : "启用"}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={remove.isPending}
              onClick={() => {
                void remove
                  .mutateAsync(ep.id)
                  .then(() => onNotice({ tone: "ok", text: `已删除「${ep.name}」` }))
                  .catch((e: Error) => onNotice({ tone: "err", text: e.message }));
              }}
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- 模型目录 ----------------------------- */

function CatalogSection({
  data,
  onNotice,
}: {
  data: ModelsPayload;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  const grouped = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        items: data.models.filter((m) => m.kind === kind),
      })).filter((g) => g.items.length > 0),
    [data.models],
  );

  return (
    <section className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">CATALOG</div>
          <h2 className="serif mt-1 text-[16px]">内置模型</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
            目录写在代码里跟着版本走，运行时开关在数据库里。改动目录需要发版，关停某个模型在管理台就能做。
          </p>
        </div>
        <span className="mono text-[10.5px]" style={{ color: "var(--t3)" }}>
          共 {data.models.length} 个 · 可用 {data.models.filter((m) => m.usable).length} 个
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {grouped.map((g) => (
          <div key={g.kind}>
            <div className="mb-2 flex items-center gap-2">
              <span className="mono text-[10px]" style={{ color: "var(--gold)" }}>
                {KIND_LABEL[g.kind].toUpperCase()}
              </span>
              <span className="h-px flex-1" style={{ background: "var(--line)" }} />
            </div>
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
              {g.items.map((m) => (
                <ModelRow key={m.key} model={m} canManage={data.canManageKeys} onNotice={onNotice} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelRow({
  model,
  canManage,
  onNotice,
}: {
  model: ModelPayload;
  canManage: boolean;
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void;
}) {
  const toggle = useToggleModel();
  const tone = model.usable ? "var(--jade)" : "var(--t3)";
  const source =
    model.keySource === "byok" ? "你的 Key" : model.keySource === "platform" ? "平台代付" : "无 Key";
  // 本地模型是整条链路的兜底，不允许关停
  const locked = model.provider === "local";

  return (
    <div
      className="rounded-[10px] border p-3"
      style={{
        borderColor: model.usable ? "var(--line)" : "color-mix(in srgb, var(--line) 60%, transparent)",
        background: "var(--surface-2)",
        opacity: model.usable ? 1 : 0.72,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-[6px] w-[6px] rounded-full"
            style={{ background: tone }}
            aria-hidden="true"
          />
          <b className="text-[12.5px]">{model.label}</b>
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {model.modelName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="chip" style={{ fontSize: 10 }}>
            {PLAN_NAME[model.requiresPlan] ?? model.requiresPlan}
          </span>
          {locked ? (
            <span className="chip" style={{ fontSize: 10, color: "var(--t3)" }} title="本地模型是降级兜底，不可关停">
              兜底
            </span>
          ) : (
            canManage && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                style={{ padding: "1px 7px", fontSize: 10 }}
                disabled={toggle.isPending}
                onClick={() => {
                  void toggle
                    .mutateAsync({ key: model.key, enabled: !model.enabled })
                    .then(() =>
                      onNotice({
                        tone: "ok",
                        text: `「${model.label}」已${model.enabled ? "关停" : "启用"}`,
                      }),
                    )
                    .catch((e: Error) => onNotice({ tone: "err", text: e.message }));
                }}
              >
                {model.enabled ? "关停" : "启用"}
              </button>
            )
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--t3)" }}>
        {model.note}
      </p>

      <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: "var(--t3)" }}>
        <span>{model.vendor}</span>
        <span>{PROTOCOL_LABEL[model.protocol] ?? model.protocol}</span>
        <span>
          {model.credits} 积分 · ¥{model.unitPrice}/{UNIT_LABEL[model.unit] ?? model.unit}
        </span>
        <span style={{ color: model.keySource === "byok" ? "var(--jade)" : "var(--t3)" }}>{source}</span>
        {model.byokOnly && <span style={{ color: "var(--gold)" }}>需自带 Key</span>}
      </div>

      {!model.usable && model.reason && (
        <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--rose)" }}>
          {model.reason}
        </p>
      )}
    </div>
  );
}

const UNIT_LABEL: Record<string, string> = {
  k_token: "千 token",
  image: "张",
  video_second: "秒",
  k_char: "千字",
  render: "次",
};

/* ----------------------------- 工作机制 ----------------------------- */

function HowItWorks({ data }: { data: ModelsPayload }) {
  const steps = [
    {
      t: "注册",
      d: "模型写在 src/lib/ai/catalog.ts：key、协议、路径、单价、所需套餐。启动时同步进 model_catalog 表，只补缺行，不覆盖运维改过的开关。",
    },
    {
      t: "扩展",
      d: "任何 OpenAI 兼容服务都能接：填 URL + 模型名 + Key，落库后立刻出现在目录里，和内置模型共用同一套路由、计费与降级，不需要改代码发版。",
    },
    {
      t: "选型",
      d: "按 显式偏好 → 能力匹配 → 目录优先级 → 降级链 → 本地兜底 依次挑。本地模型永远排最后，保证任何情况下都有产出。",
    },
    {
      t: "鉴权",
      d: `先查你填的 Key（BYOK），没有再回落到平台 Key。解密失败直接报错，不静默换成平台 Key —— 免得你以为在用自己额度却被计费。当前套餐：${PLAN_NAME[data.planCode] ?? data.planCode}。`,
    },
    {
      t: "计费",
      d: "平台代付按工具基准价扣积分；自带 Key 只扣 1 点平台服务费。BYOK 的真实成本记 0 元，因为钱直接付给了供应商。",
    },
    {
      t: "容错",
      d: "远端失败（鉴权、限流、超时）自动降级到本地引擎，任务仍然成功，降级原因写在任务输出的 degraded 字段里，界面会提示。",
    },
  ];

  return (
    <section className="card p-4 lg:p-5">
      <div className="eyebrow">HOW IT WORKS</div>
      <h2 className="serif mt-1 text-[16px]">注册 · 鉴权 · 计费</h2>
      <ol className="mt-3 flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-3">
            <span
              className="mono mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px]"
              style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
            >
              {i + 1}
            </span>
            <div>
              <b className="text-[12px]">{s.t}</b>
              <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--t3)" }}>
                {s.d}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
