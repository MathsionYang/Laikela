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

export function clientAsset(a: AssetRow) {
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
    meta: a.meta,
    createdAt: a.created_at,
  };
}
