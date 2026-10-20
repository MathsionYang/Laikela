/**
 * 积分账户。设计原则：
 *
 *  1. 余额永远由流水推导（balance = sum(delta)），不存冗余余额字段，避免更新丢失
 *  2. 每次写流水前对 org 加事务级 advisory lock，串行化同一租户的并发扣减
 *  3. 每条流水带 idempotency_key，重试/重复回调不会重复扣或重复补
 *  4. 扣减发生在「建任务时」，失败/取消时自动退款，用户不会被白扣
 */
import { newId, q, q1, tx, type Queryable } from "@/lib/db";

export type CreditKind = "grant" | "consume" | "refund" | "expire" | "adjust";

export class CreditError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface LedgerRow {
  id: string;
  org_id: string;
  job_id: string | null;
  kind: CreditKind;
  delta: number;
  balance_after: number;
  reason: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** 同一租户的积分写操作串行化（事务级锁，提交/回滚自动释放） */
async function lockOrg(c: Queryable, orgId: string) {
  await c.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [orgId]);
}

async function balanceOf(c: Queryable, orgId: string): Promise<number> {
  const rows = await c.query<{ bal: string }>(
    `select coalesce(sum(delta), 0)::text as bal from credit_ledger where org_id = $1`,
    [orgId],
  );
  return Number(rows[0]?.bal ?? 0);
}

export async function balance(orgId: string): Promise<number> {
  const row = await q1<{ bal: string }>(
    `select coalesce(sum(delta), 0)::text as bal from credit_ledger where org_id = $1`,
    [orgId],
  );
  return Number(row?.bal ?? 0);
}

/** 记一笔流水（内部使用，调用方负责加锁） */
async function writeEntry(
  c: Queryable,
  params: {
    orgId: string;
    jobId?: string | null;
    kind: CreditKind;
    delta: number;
    balanceAfter: number;
    reason: string;
    key: string;
    meta?: Record<string, unknown>;
  },
): Promise<boolean> {
  const rows = await c.query<{ id: string }>(
    `insert into credit_ledger (id, org_id, job_id, kind, delta, balance_after, reason, idempotency_key, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      newId("cdt"),
      params.orgId,
      params.jobId ?? null,
      params.kind,
      params.delta,
      params.balanceAfter,
      params.reason,
      params.key,
      JSON.stringify(params.meta ?? {}),
    ],
  );
  return rows.length > 0;
}

/** 入账：订阅发放、活动赠送、人工补偿 */
export async function grant(params: {
  orgId: string;
  credits: number;
  reason: string;
  key: string;
  meta?: Record<string, unknown>;
}): Promise<{ balance: number; applied: boolean }> {
  if (params.credits <= 0) throw new CreditError("INVALID_AMOUNT", "入账积分必须大于 0");
  return tx(async (c) => {
    await lockOrg(c, params.orgId);
    const before = await balanceOf(c, params.orgId);
    const applied = await writeEntry(c, {
      orgId: params.orgId,
      kind: "grant",
      delta: params.credits,
      balanceAfter: before + params.credits,
      reason: params.reason,
      key: params.key,
      meta: params.meta,
    });
    return { balance: applied ? before + params.credits : before, applied };
  });
}

/**
 * 扣减：建任务前调用。
 * 余额不足返回 ok:false（由调用方转成 402），不做负数余额。
 */
export async function consume(params: {
  orgId: string;
  jobId: string;
  credits: number;
  reason: string;
}): Promise<{ ok: boolean; balance: number; applied: boolean }> {
  if (params.credits <= 0) return { ok: true, balance: await balance(params.orgId), applied: false };
  return tx(async (c) => {
    await lockOrg(c, params.orgId);
    const before = await balanceOf(c, params.orgId);

    // 幂等：已扣过就直接返回当前余额
    const done = await c.query<{ balance_after: number }>(
      `select balance_after from credit_ledger where idempotency_key = $1`,
      [`job:${params.jobId}:consume`],
    );
    if (done.length) return { ok: true, balance: before, applied: false };

    if (before < params.credits) return { ok: false, balance: before, applied: false };

    await writeEntry(c, {
      orgId: params.orgId,
      jobId: params.jobId,
      kind: "consume",
      delta: -params.credits,
      balanceAfter: before - params.credits,
      reason: params.reason,
      key: `job:${params.jobId}:consume`,
      meta: { credits: params.credits },
    });
    return { ok: true, balance: before - params.credits, applied: true };
  });
}

/** 退款：任务失败 / 取消 / 审核拦截时调用，幂等 */
export async function refund(params: {
  orgId: string;
  jobId: string;
  reason: string;
}): Promise<{ balance: number; applied: boolean; credits: number }> {
  return tx(async (c) => {
    await lockOrg(c, params.orgId);
    const before = await balanceOf(c, params.orgId);

    const spent = await c.query<{ delta: number }>(
      `select delta from credit_ledger where idempotency_key = $1`,
      [`job:${params.jobId}:consume`],
    );
    const credits = Math.abs(Number(spent[0]?.delta ?? 0));
    if (!credits) return { balance: before, applied: false, credits: 0 };

    const applied = await writeEntry(c, {
      orgId: params.orgId,
      jobId: params.jobId,
      kind: "refund",
      delta: credits,
      balanceAfter: before + credits,
      reason: params.reason,
      key: `job:${params.jobId}:refund`,
      meta: { credits },
    });
    return { balance: applied ? before + credits : before, applied, credits };
  });
}

/** 扣减后的补偿性调整（例如模型重试多消耗） */
export async function adjust(params: {
  orgId: string;
  credits: number; // 可正可负
  reason: string;
  key: string;
  meta?: Record<string, unknown>;
}): Promise<{ balance: number; applied: boolean }> {
  return tx(async (c) => {
    await lockOrg(c, params.orgId);
    const before = await balanceOf(c, params.orgId);
    if (before + params.credits < 0) throw new CreditError("INSUFFICIENT_CREDITS", "调整后余额不能为负");
    const applied = await writeEntry(c, {
      orgId: params.orgId,
      kind: "adjust",
      delta: params.credits,
      balanceAfter: before + params.credits,
      reason: params.reason,
      key: params.key,
      meta: params.meta,
    });
    return { balance: applied ? before + params.credits : before, applied };
  });
}

export async function ledger(orgId: string, limit = 30): Promise<LedgerRow[]> {
  const rows = await q<LedgerRow>(
    `select id, org_id, job_id, kind, delta, balance_after, reason, meta, created_at
     from credit_ledger where org_id = $1
     order by created_at desc, id desc limit $2`,
    [orgId, Math.min(limit, 200)],
  );
  return rows.map((r) => ({ ...r, delta: Number(r.delta), balance_after: Number(r.balance_after) }));
}

export async function summary(orgId: string): Promise<{
  balance: number;
  grantedThisMonth: number;
  consumedThisMonth: number;
  refundedThisMonth: number;
}> {
  const row = await q1<{ granted: string; consumed: string; refunded: string }>(
    `select
       coalesce(sum(delta) filter (where kind = 'grant'), 0)::text as granted,
       coalesce(sum(-delta) filter (where kind = 'consume'), 0)::text as consumed,
       coalesce(sum(delta) filter (where kind = 'refund'), 0)::text as refunded
     from credit_ledger
     where org_id = $1 and created_at >= date_trunc('month', now())`,
    [orgId],
  );
  return {
    balance: await balance(orgId),
    grantedThisMonth: Number(row?.granted ?? 0),
    consumedThisMonth: Number(row?.consumed ?? 0),
    refundedThisMonth: Number(row?.refunded ?? 0),
  };
}
