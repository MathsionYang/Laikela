import type { AssetRow, JobRow } from "./repo";
import { assetUrl } from "./repo";

export interface ClientJob {
  id: string;
  tool: string;
  status: string;
  stage: string;
  progress: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  /** 创建时路由选定的模型（目录 key） */
  modelKey: string | null;
  promptVersion: string | null;
  error: { code: string; message: string } | null;
  cost: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function clientJob(j: JobRow): ClientJob {
  return {
    id: j.id,
    tool: j.tool_slug,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    input: j.input ?? {},
    output: j.output ?? null,
    provider: j.model_provider,
    model: j.model_name,
    modelKey: j.model_key ?? null,
    promptVersion: j.prompt_version,
    error: j.error_code ? { code: j.error_code, message: j.error_message ?? "" } : null,
    cost: Number(j.cost_cny ?? 0),
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  };
}

export function clientAsset(a: AssetRow, thumbUrl?: string | null) {
  return {
    id: a.id,
    kind: a.kind,
    role: a.role,
    name: a.name,
    mime: a.mime,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    durationMs: a.duration_ms,
    url: assetUrl(a),
    /** 列表用小图（有缩略图就是 webp，没有就回落到原图） */
    thumbUrl: thumbUrl ?? null,
    /** 带 Content-Disposition 的下载口，文件名取素材名而不是存储 key */
    downloadUrl: `/api/assets/${a.id}/download`,
    jobId: a.job_id,
    /** 文字类素材的正文摘要，列表直接显示，不用再请求一次 */
    preview: typeof a.meta?.preview === "string" ? a.meta.preview : null,
    meta: a.meta,
    createdAt: a.created_at,
  };
}
