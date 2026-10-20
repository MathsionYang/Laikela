import { newId, q, q1 } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export type JobStatus =
  | "queued"
  | "running"
  | "post_processing"
  | "reviewing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface JobRow {
  id: string;
  org_id: string;
  tool_slug: string;
  status: JobStatus;
  stage: string;
  progress: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  model_provider: string | null;
  model_name: string | null;
  /** 创建时路由选定的模型（目录 key），执行时作为首选 */
  model_key: string | null;
  prompt_version: string | null;
  parent_job_id: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  cost_cny: string;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AssetRow {
  id: string;
  org_id: string;
  job_id: string | null;
  kind: string;
  role: string;
  name: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  storage_key: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export async function createJob(params: {
  orgId: string;
  toolSlug: string;
  input: Record<string, unknown>;
  parentJobId?: string | null;
  modelKey?: string | null;
}): Promise<JobRow> {
  const row = await q1<JobRow>(
    `insert into jobs (id, org_id, tool_slug, status, stage, progress, input, parent_job_id, model_key)
     values ($1,$2,$3,'queued','排队中',0,$4,$5,$6) returning *`,
    [
      newId("job"),
      params.orgId,
      params.toolSlug,
      params.input,
      params.parentJobId ?? null,
      params.modelKey ?? null,
    ],
  );
  if (!row) throw new Error("创建任务失败");
  return row;
}

export async function getJob(id: string, orgId?: string): Promise<JobRow | null> {
  return orgId
    ? q1<JobRow>(`select * from jobs where id = $1 and org_id = $2`, [id, orgId])
    : q1<JobRow>(`select * from jobs where id = $1`, [id]);
}

export async function listJobs(
  orgId: string,
  opts: { limit?: number; toolSlug?: string; status?: string } = {},
): Promise<JobRow[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  if (opts.toolSlug) {
    return q<JobRow>(
      `select * from jobs where org_id = $1 and tool_slug = $2 order by created_at desc limit $3`,
      [orgId, opts.toolSlug, limit],
    );
  }
  if (opts.status) {
    return q<JobRow>(
      `select * from jobs where org_id = $1 and status = $2 order by created_at desc limit $3`,
      [orgId, opts.status, limit],
    );
  }
  return q<JobRow>(
    `select * from jobs where org_id = $1 order by created_at desc limit $2`,
    [orgId, limit],
  );
}

export async function updateJob(
  id: string,
  patch: Partial<
    Pick<
      JobRow,
      | "status"
      | "stage"
      | "progress"
      | "output"
      | "model_provider"
      | "model_name"
      | "prompt_version"
      | "attempts"
      | "error_code"
      | "error_message"
      | "cost_cny"
    >
  > & { started?: boolean; finished?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = $${i++}`);
    vals.push(v);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.stage !== undefined) push("stage", patch.stage);
  if (patch.progress !== undefined) push("progress", Math.max(0, Math.min(100, patch.progress)));
  if (patch.output !== undefined) push("output", patch.output);
  if (patch.model_provider !== undefined) push("model_provider", patch.model_provider);
  if (patch.model_name !== undefined) push("model_name", patch.model_name);
  if (patch.prompt_version !== undefined) push("prompt_version", patch.prompt_version);
  if (patch.attempts !== undefined) push("attempts", patch.attempts);
  if (patch.error_code !== undefined) push("error_code", patch.error_code);
  if (patch.error_message !== undefined) push("error_message", patch.error_message);
  if (patch.cost_cny !== undefined) push("cost_cny", patch.cost_cny);
  if (patch.started) sets.push(`started_at = coalesce(started_at, now())`);
  if (patch.finished) sets.push(`finished_at = now()`);
  if (!sets.length) return;
  vals.push(id);
  await q(`update jobs set ${sets.join(", ")} where id = $${i}`, vals);
}

export async function requestCancel(id: string): Promise<void> {
  await q(
    `update jobs set cancel_requested = true,
       status = case when status in ('queued','running','post_processing','reviewing') then 'canceled' else status end,
       stage = case when status in ('queued','running','post_processing','reviewing') then '已取消' else stage end,
       finished_at = coalesce(finished_at, now())
     where id = $1`,
    [id],
  );
}

export async function isCanceled(id: string): Promise<boolean> {
  const row = await q1<{ cancel_requested: boolean }>(
    `select cancel_requested from jobs where id = $1`,
    [id],
  );
  return Boolean(row?.cancel_requested);
}

/* ------------------------------- 素材 ------------------------------- */

export async function addAsset(params: {
  orgId: string;
  jobId: string | null;
  kind: string;
  role: string;
  name: string;
  mime: string;
  body: Buffer;
  storageKey: string;
  width?: number;
  height?: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}): Promise<AssetRow> {
  const row = await q1<AssetRow>(
    `insert into assets (id, org_id, job_id, kind, role, name, mime, bytes, width, height, duration_ms, storage_key, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [
      newId("ast"),
      params.orgId,
      params.jobId,
      params.kind,
      params.role,
      params.name,
      params.mime,
      params.body.length,
      params.width ?? null,
      params.height ?? null,
      params.durationMs ?? null,
      params.storageKey,
      params.meta ?? {},
    ],
  );
  if (!row) throw new Error("写入素材失败");
  return row;
}

export async function listAssets(
  orgId: string,
  opts: { limit?: number; kind?: string; jobId?: string; role?: string } = {},
): Promise<AssetRow[]> {
  const limit = Math.min(opts.limit ?? 60, 1000);
  const where: string[] = ["org_id = $1"];
  const vals: unknown[] = [orgId];
  let i = 2;
  if (opts.kind) {
    where.push(`kind = $${i++}`);
    vals.push(opts.kind);
  }
  if (opts.jobId) {
    where.push(`job_id = $${i++}`);
    vals.push(opts.jobId);
  }
  if (opts.role) {
    where.push(`role = $${i++}`);
    vals.push(opts.role);
  }
  vals.push(limit);
  return q<AssetRow>(
    `select * from assets where ${where.join(" and ")} order by created_at desc limit $${i}`,
    vals,
  );
}

export function assetUrl(a: AssetRow): string {
  return signedUrl(a.storage_key);
}

/* ------------------------------- 计费 ------------------------------- */

export async function addUsage(params: {
  orgId: string;
  jobId: string;
  provider: string;
  model: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  costCny: number;
}): Promise<void> {
  await q(
    `insert into usage_records (id, org_id, job_id, provider, model, unit, quantity, unit_price, currency, cost_cny)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'CNY',$9)`,
    [
      newId("usg"),
      params.orgId,
      params.jobId,
      params.provider,
      params.model,
      params.unit,
      params.quantity,
      params.unitPrice,
      params.costCny,
    ],
  );
}

export async function usageSummary(orgId: string): Promise<{
  monthCredits: number;
  monthCost: number;
  quota: number;
  byProvider: Array<{ provider: string; cost: number; count: number }>;
}> {
  const quotaRow = await q1<{ quota_month: number }>(
    `select quota_month from organizations where id = $1`,
    [orgId],
  );
  const sum = await q1<{ credits: string; cost: string }>(
    `select coalesce(sum(quantity),0)::text as credits, coalesce(sum(cost_cny),0)::text as cost
     from usage_records
     where org_id = $1 and created_at >= date_trunc('month', now())`,
    [orgId],
  );
  const byProvider = await q<{ provider: string; cost: string; count: string }>(
    `select provider, coalesce(sum(cost_cny),0)::text as cost, count(*)::text as count
     from usage_records
     where org_id = $1 and created_at >= date_trunc('month', now())
     group by provider order by sum(cost_cny) desc`,
    [orgId],
  );
  return {
    monthCredits: Number(sum?.credits ?? 0),
    monthCost: Number(sum?.cost ?? 0),
    quota: quotaRow?.quota_month ?? 2000,
    byProvider: byProvider.map((r) => ({
      provider: r.provider,
      cost: Number(r.cost),
      count: Number(r.count),
    })),
  };
}

/* --------------------------- 审核 / 审计 --------------------------- */

export async function addModeration(params: {
  orgId: string;
  jobId: string | null;
  target: string;
  level: "pass" | "warn" | "block";
  hits: Array<{ term: string; level: string; suggestion: string }>;
  suggestion?: string;
}): Promise<void> {
  await q(
    `insert into moderation_records (id, org_id, job_id, target, level, hits, suggestion)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("mod"),
      params.orgId,
      params.jobId,
      params.target,
      params.level,
      JSON.stringify(params.hits),
      params.suggestion ?? null,
    ],
  );
}

export async function audit(params: {
  orgId: string;
  actor?: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await q(
    `insert into audit_logs (id, org_id, actor, action, target, detail)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      newId("aud"),
      params.orgId,
      params.actor ?? "owner",
      params.action,
      params.target ?? null,
      params.detail ?? {},
    ],
  );
}

export { dbHealth } from "@/lib/db";
