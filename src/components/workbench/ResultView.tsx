"use client";

import { Icon } from "@/components/Icon";
import type { ClientAsset, ClientJob } from "@/lib/client/api";
import { AudioResult } from "./AudioResult";
import { CopyResult } from "./CopyResult";
import { ImageResult } from "./ImageResult";
import { VideoResult } from "./VideoResult";

interface Moderation {
  level: "pass" | "warn" | "block";
  hits: Array<{ term: string; rule: string; suggestion: string }>;
  suggestion: string;
}

export function ResultView({
  job,
  assets,
  onRetry,
}: {
  job: ClientJob;
  assets: ClientAsset[];
  onRetry?: () => void;
}) {
  const out = (job.output ?? {}) as Record<string, unknown>;
  const type = String(out.type ?? "");
  const mod = out.moderation as Moderation | undefined;
  const degraded = typeof out.degraded === "string" && out.degraded ? out.degraded : null;

  return (
    <div className="flex flex-col gap-3">
      {mod && mod.level !== "pass" && <ModerationBar mod={mod} />}
      {degraded && <DegradedBar text={degraded} />}

      {type === "copy" && (
        <CopyResult
          jobId={job.id}
          html={String(out.html ?? "")}
          plain={String(out.plain ?? "")}
          blocks={out.blocks}
        />
      )}

      {type === "image" && <ImageResult assets={assets} />}

      {type === "audio" && (
        <AudioResult
          url={String((out.asset as ClientAsset | undefined)?.url ?? "")}
          durationMs={Number(out.durationMs ?? 0)}
          segments={(out.segments as Array<{ index: number; text: string; startMs: number; endMs: number }>) ?? []}
          downloadName={`来客啦-音轨-${job.id.slice(-6)}.wav`}
        />
      )}

      {type === "video" && (
        <VideoResult
          timeline={
            out.timeline as {
              width: number;
              height: number;
              fps: number;
              durationMs: number;
              shots: Array<{
                index: number;
                startMs: number;
                endMs: number;
                scene: string;
                caption: string;
                note: string;
              }>;
              meta: Record<string, unknown>;
            }
          }
          frames={
            (out.frames as Array<{ shotIndex: number; variant: number; asset: ClientAsset }>) ?? []
          }
          video={(out.videoAsset as ClientAsset | null) ?? null}
          assets={assets}
        />
      )}

      {!type && (
        <div className="flex flex-col items-start gap-2 py-8">
          <span className="text-[12px]" style={{ color: "var(--t3)" }}>
            该任务没有可预览的产出
          </span>
          {onRetry && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              <Icon name="refresh" size={12} /> 重新生成
            </button>
          )}
        </div>
      )}

      <MetaBar job={job} />
    </div>
  );
}

function ModerationBar({ mod }: { mod: Moderation }) {
  const block = mod.level === "block";
  return (
    <div
      className="rounded-[9px] border px-3 py-2.5"
      style={{
        borderColor: block
          ? "color-mix(in srgb, var(--rose) 42%, transparent)"
          : "color-mix(in srgb, var(--gold) 36%, transparent)",
        background: block ? "var(--rose-soft)" : "var(--gold-soft)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: block ? "var(--rose)" : "var(--gold)" }}>
        <Icon name="alert" size={13} />
        {block ? "内容审查发现高风险表述，建议改写后再发布" : "内容审查有提示"}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {mod.hits.slice(0, 4).map((h, i) => (
          <li key={i} className="text-[11px] leading-relaxed" style={{ color: "var(--t2)" }}>
            <span className="mono" style={{ color: block ? "var(--rose)" : "var(--gold)" }}>
              {h.rule}
            </span>
            ：命中「{h.term}」—— {h.suggestion}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 首选模型不可用、已降级到本地引擎时，必须让用户看见 */
function DegradedBar({ text }: { text: string }) {
  return (
    <div
      className="flex items-start gap-1.5 rounded-[9px] border px-3 py-2 text-[11px] leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--gold) 34%, transparent)",
        background: "var(--gold-soft)",
        color: "var(--gold)",
      }}
      role="status"
    >
      <Icon name="alert" size={13} />
      <span>{text}</span>
    </div>
  );
}

function MetaBar({ job }: { job: ClientJob }) {
  const model = (job.output?.model ?? null) as
    | { key: string; label: string; keySource: "byok" | "platform" }
    | null;
  const items = [
    { k: "模型", v: model?.label ?? job.model ?? "—" },
    { k: "供应商", v: job.provider ?? "—" },
    { k: "付费", v: model?.keySource === "byok" ? "你的 Key" : "平台代付" },
    { k: "提示词", v: job.promptVersion ?? "—" },
    { k: "费用", v: `¥${job.cost.toFixed(3)}` },
    { k: "耗时", v: duration(job) },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-[10px]"
      style={{ borderColor: "var(--line)", color: "var(--t3)" }}
    >
      {items.map((it) => (
        <span key={it.k} className="flex items-center gap-1">
          {it.k}
          <span className="mono" style={{ color: "var(--t2)" }}>
            {it.v}
          </span>
        </span>
      ))}
      <span className="mono ml-auto" style={{ opacity: 0.7 }}>
        {job.id}
      </span>
    </div>
  );
}

function duration(job: ClientJob) {
  if (!job.startedAt || !job.finishedAt) return "—";
  const ms = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
