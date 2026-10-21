"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { ToolDef, ToolField } from "@/lib/domain/tools";
import { mergeInput } from "@/lib/domain/tools";
import { baseCredits, LOCAL_ETA_FACTOR, quoteCost, unitsOf } from "@/lib/domain/pricing";
import { uploadAssets, useModels, type ClientAsset, type ModelPayload, type ToolQuote } from "@/lib/client/api";

interface Props {
  /** 带服务端报价的工具定义：报价决定「自动路由」时的价格，不能省 */
  tool: ToolDef & { quote?: ToolQuote | null };
  busy: boolean;
  onSubmit: (values: Record<string, unknown>, modelKey: string | null) => void;
  /** 从历史版本载入的参数；不传就是空白表单。父组件用 key 重建来触发重置 */
  initialValues?: Record<string, unknown> | null;
  initialModelKey?: string | null;
  /** 上传类字段的已选素材（按字段 id 分组），回填时用来显示文件名 */
  initialUploads?: Record<string, ClientAsset[]>;
  /** 用户改动过表单就报 true —— 父组件用它做「载入历史会不会覆盖草稿」的保护 */
  onDirtyChange?: (dirty: boolean) => void;
}

/** 工具产出类型 → 模型类型 */
const MODEL_KIND: Record<string, ModelPayload["kind"]> = {
  copy: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

/** 计费单位的中文说法，跟 pricing.ts 的计费量口径一一对应 */
const UNIT_LABEL: Record<string, string> = {
  copy: "千 token",
  image: "张",
  video: "秒",
  audio: "千字符",
};

export function ToolForm({
  tool,
  busy,
  onSubmit,
  initialValues,
  initialModelKey,
  initialUploads,
  onDirtyChange,
}: Props) {
  // 初始化时就把历史参数合进来：父组件通过 key 变化重建本组件，
  // 所以这里不需要 useEffect 去同步外部值，也就没有「输入框闪一下」的问题。
  const [values, setValues] = useState<Record<string, unknown>>(
    () => mergeInput(tool, initialValues).values,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, ClientAsset[]>>(initialUploads ?? {});
  const [modelKey, setModelKey] = useState<string>(initialModelKey ?? "");

  const { data: modelData } = useModels();
  const kind = MODEL_KIND[tool.kind] ?? "text";
  const options = useMemo(
    () => (modelData?.models ?? []).filter((m) => m.kind === kind && m.usable),
    [modelData, kind],
  );

  const selected = options.find((m) => m.key === modelKey) ?? null;

  /**
   * 价格与服务端同源：
   *   · 选了模型 → 按该模型单价
   *   · 自动路由 → 按服务端报价里那个「真正会被选中的模型」的单价
   * 两者都用 unitsOf(input) 换算，所以改张数 / 时长 / 篇幅时这里会实时变，
   * 且与服务端扣费一分不差。
   */
  const planCode = modelData?.planCode;
  const auto = tool.quote;
  const cost = selected
    ? quoteCost(tool, selected.unitPrice, selected.keySource, planCode, values)
    : auto
      ? quoteCost(tool, auto.unitPrice, auto.keySource === "byok" ? "byok" : "platform", planCode, values)
      : baseCredits(tool);
  const units = unitsOf(tool, values);
  // 耗时也要跟着模型走：本地引擎 ≈ 基线 × 0.7，云端 = 基线；
  // 自动路由时直接用服务端的实测值
  const eta = !selected || selected.key === auto?.modelKey
    ? (auto?.etaSeconds ?? tool.etaBaseline)
    : selected.provider === "local"
      ? Math.max(1, Math.round(tool.etaBaseline * LOCAL_ETA_FACTOR))
      : tool.etaBaseline;

  const set = (id: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    onDirtyChange?.(true);
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const f of tool.fields) {
      if (f.required && !String(values[f.id] ?? "").trim()) next[f.id] = `请填写${f.label}`;
    }
    setErrors(next);
    if (Object.keys(next).length) {
      const firstId = Object.keys(next)[0];
      document.getElementById(`fld-${firstId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      (document.getElementById(`fld-${firstId}`) as HTMLElement | null)?.focus?.();
      return;
    }
    onSubmit(values, modelKey || null);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tool.fields.map((f) => (
          <Field
            key={f.id}
            field={f}
            value={values[f.id]}
            error={errors[f.id]}
            uploads={uploads[f.id] ?? []}
            onChange={(v) => set(f.id, v)}
            onUploaded={(assets) => {
              setUploads((prev) => ({ ...prev, [f.id]: assets }));
              onDirtyChange?.(true);
            }}
          />
        ))}
      </div>

      <div className="mt-1 flex flex-col gap-2 border-t pt-3.5" style={{ borderColor: "var(--line)" }}>
        {/* 模型选择：留空即自动路由 */}
        <div className="field">
          <label className="field-label" htmlFor="fld-model">
            生成模型
            <span className="req" style={{ color: "var(--t3)", background: "transparent" }}>
              {selected?.keySource === "byok" ? "自带 Key" : "平台代付"}
            </span>
          </label>
          <select
            id="fld-model"
            className="select"
            value={modelKey}
            onChange={(e) => {
              setModelKey(e.target.value);
              onDirtyChange?.(true);
            }}
          >
            <option value="">自动（按套餐与可用性挑选）</option>
            {options.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} · {m.vendor}
                {m.keySource === "byok" ? " · 你的 Key" : ""}
              </option>
            ))}
          </select>
          {options.length === 0 && modelData && (
            <span className="text-[10px]" style={{ color: "var(--t3)" }}>
              当前套餐只能走本地引擎，
              <Link href="/settings/models" className="underline" style={{ color: "var(--gold)" }}>
                去配置 Key
              </Link>
              可解锁云端模型
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[10.5px]" style={{ color: "var(--t3)" }}>
            ≈{eta} 秒 · 消耗 {cost} 积分
            {selected?.keySource === "byok" ? "（平台服务费）" : ""}
            <span className="ml-1" style={{ opacity: 0.75 }}>
              · {units} {UNIT_LABEL[tool.kind]}
              {" · "}
              {selected?.label ?? auto?.modelLabel ?? "本地引擎"}
            </span>
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Icon name="spark" size={14} />
            {busy ? "生成中…" : `生成${tool.kind === "copy" ? "文案" : ""}`}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed" style={{ color: "var(--t3)" }}>
          {tool.billingNote ? `${tool.billingNote}。` : ""}提交后会创建一条任务，结果自动归档到素材库。
          生成内容仍需人工核对价格、时间与资质表述。
        </p>
      </div>
    </form>
  );
}

function Field({
  field,
  value,
  error,
  uploads,
  onChange,
  onUploaded,
}: {
  field: ToolField;
  value: unknown;
  error?: string;
  uploads: ClientAsset[];
  onChange: (v: unknown) => void;
  onUploaded: (assets: ClientAsset[]) => void;
}) {
  const err = Boolean(error);

  const label = (
    <label className="field-label" htmlFor={`fld-${field.id}`}>
      {field.label}
      {field.required && <span className="req">必填</span>}
    </label>
  );

  return (
    <div className={`field ${field.full ? "sm:col-span-2" : ""} ${err ? "has-error" : ""}`}>
      {field.type !== "picks" && label}

      {field.type === "text" && (
        <input
          id={`fld-${field.id}`}
          className="input"
          value={String(value ?? "")}
          placeholder={field.ph}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          id={`fld-${field.id}`}
          className="textarea"
          rows={field.full ? 3 : 2}
          value={String(value ?? "")}
          placeholder={field.ph}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "select" && (
        <select
          id={`fld-${field.id}`}
          className="select"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.opts?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      {field.type === "picks" && (
        <>
          <label className="field-label">
            {field.label}
            {field.required && <span className="req">必填</span>}
          </label>
          <div className="picks">
            {field.opts?.map((o, i) => {
              const on = field.multi
                ? String(value ?? "").split(",").filter(Boolean).includes(o)
                : value === o;
              return (
                <button
                  key={o}
                  type="button"
                  className="pick"
                  data-on={on ? "1" : "0"}
                  aria-pressed={on}
                  onClick={() => {
                    if (!field.multi) return onChange(o);
                    const cur = String(value ?? "").split(",").filter(Boolean);
                    onChange(
                      cur.includes(o) ? cur.filter((x) => x !== o).join(",") : [...cur, o].join(","),
                    );
                  }}
                >
                  {field.colors?.[i] && (
                    <i className="sw" style={{ background: field.colors[i] }} aria-hidden="true" />
                  )}
                  {o}
                </button>
              );
            })}
          </div>
        </>
      )}

      {field.type === "range" && (
        <>
          <div className="flex items-center justify-between">
            <label className="field-label" htmlFor={`fld-${field.id}`}>
              {field.label}
            </label>
            <span className="range-val">
              {field.after
                ? `${value ?? field.value}${field.suffix ?? ""}`
                : `${field.suffix ?? ""}${value ?? field.value}`}
            </span>
          </div>
          <div className="range-row">
            <input
              id={`fld-${field.id}`}
              type="range"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={Number(value ?? field.value ?? 0)}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          </div>
        </>
      )}

      {field.type === "upload" && (
        <Uploader field={field} uploads={uploads} onUploaded={onUploaded} onChange={onChange} />
      )}

      {error && (
        <span className="text-[10.5px]" style={{ color: "var(--rose)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function Uploader({
  field,
  uploads,
  onUploaded,
  onChange,
}: {
  field: ToolField;
  uploads: ClientAsset[];
  onUploaded: (assets: ClientAsset[]) => void;
  onChange: (v: unknown) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!uploads.length) return null;
    if (uploads.length === 1) return uploads[0].name;
    return `${uploads[0].name} 等 ${uploads.length} 个文件`;
  }, [uploads]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      const assets = await uploadAssets(Array.from(files).slice(0, 6));
      const merged = [...uploads, ...assets].slice(0, 6);
      onUploaded(merged);
      onChange(merged.map((a) => a.id).join(","));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label
        className="dropzone"
        htmlFor={`fld-${field.id}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.dataset.over = "1";
        }}
        onDragLeave={(e) => delete e.currentTarget.dataset.over}
        onDrop={(e) => {
          e.preventDefault();
          delete e.currentTarget.dataset.over;
          void pick(e.dataTransfer.files);
        }}
      >
        <Icon name={busy ? "refresh" : "upload"} size={16} style={{ color: "var(--gold)" }} />
        <span className="min-w-0 flex-1">
          <b className="truncate">{summary ?? (busy ? "上传中…" : field.uploadCta ?? "点击上传")}</b>
          <span className="block truncate">{err ?? field.uploadNote}</span>
        </span>
        {uploads.length > 0 && (
          <span className="mono shrink-0 text-[10px]" style={{ color: "var(--jade)" }}>
            {uploads.length} 个
          </span>
        )}
        <input
          ref={ref}
          id={`fld-${field.id}`}
          type="file"
          hidden
          multiple
          accept={field.accept}
          onChange={(e) => void pick(e.target.files)}
        />
      </label>
    </>
  );
}
