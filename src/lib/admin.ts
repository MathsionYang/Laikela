/**
 * 平台管理员。
 *
 * 与租户角色（users.role = owner/admin/member）分开：那套角色管自己那一间工作空间，
 * 这套 is_admin 跨租户 —— 能看所有用户、直接调额度和套餐、审核人工转账。
 *
 * 提权两条路：库里置 users.is_admin，或配 ADMIN_EMAILS 环境变量（启动时自动提升）。
 */
import { newId, q, q1 } from "@/lib/db";
import { getSession, type SessionUser } from "@/lib/auth";
import { adjust as adjustCredits, grant as grantCredits, balance } from "@/lib/credits";
import { currentSubscription, getPlan, startSubscription, type Subscription } from "@/lib/billing";

export class AdminError extends Error {
  code: string;
  status: number;
  detail?: unknown;
  constructor(code: string, message: string, status = 400, detail?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AdminError("UNAUTHORIZED", "请先登录", 401);
  if (!session.isAdmin) throw new AdminError("FORBIDDEN", "需要平台管理员权限", 403);
  return session;
}

/* ------------------------------ 用户列表 ------------------------------ */

export interface AdminUserRow {
  userId: string;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
  verified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orgId: string;
  orgName: string;
  planCode: string;
  planName: string;
  periodEnd: string | null;
  autoRenew: boolean;
  balance: number;
  pendingPayments: number;
  consumedThisMonth: number;
}

export async function listUsers(params: {
  keyword?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminUserRow[]; total: number }> {
  const kw = (params.keyword ?? "").trim();
  const like = `%${kw}%`;
  const userId = params.userId ?? "";
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);

  const rows = await q<{
    user_id: string;
    email: string;
    name: string;
    role: string;
    is_admin: boolean;
    email_verified_at: string | null;
    created_at: string;
    last_login_at: string | null;
    org_id: string;
    org_name: string;
    plan: string;
    sub_plan: string | null;
    period_end: string | null;
    auto_renew: boolean | null;
    bal: string;
    pending: string;
    consumed: string;
  }>(
    `select u.id as user_id, u.email, u.name, u.role, u.is_admin, u.email_verified_at,
            u.created_at, u.last_login_at,
            o.id as org_id, o.name as org_name, o.plan,
            s.plan_code as sub_plan, s.period_end, s.auto_renew,
            coalesce((select sum(delta) from credit_ledger cl where cl.org_id = o.id), 0)::text as bal,
            coalesce((select sum(-delta) from credit_ledger cl
                      where cl.org_id = o.id and cl.kind = 'consume'
                        and cl.created_at >= date_trunc('month', now())), 0)::text as consumed,
            (select count(*) from manual_payments mp
             where mp.org_id = o.id and mp.status = 'pending')::text as pending
     from users u
     join organizations o on o.id = u.org_id
     left join lateral (
       select plan_code, period_end, auto_renew from subscriptions s2
       where s2.org_id = o.id and s2.status = 'active' order by s2.created_at desc limit 1
     ) s on true
     where ($1 = '' or u.email ilike $2 or u.name ilike $2 or o.name ilike $2)
       and ($5 = '' or u.id = $5)
     order by u.created_at desc, u.id desc
     limit $3 offset $4`,
    [kw, like, limit, offset, userId],
  );

  const plans = new Map<string, string>();
  for (const p of await q<{ code: string; name: string }>(`select code, name from plans`)) {
    plans.set(p.code, p.name);
  }

  const totalRow = await q1<{ n: string }>(
    `select count(*)::text as n from users u join organizations o on o.id = u.org_id
     where ($1 = '' or u.email ilike $2 or u.name ilike $2 or o.name ilike $2)
       and ($3 = '' or u.id = $3)`,
    [kw, like, userId],
  );

  return {
    total: Number(totalRow?.n ?? 0),
    rows: rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      name: r.name,
      role: r.role,
      isAdmin: Boolean(r.is_admin),
      verified: Boolean(r.email_verified_at),
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      orgId: r.org_id,
      orgName: r.org_name,
      planCode: r.sub_plan ?? r.plan ?? "free",
      planName: plans.get(r.sub_plan ?? r.plan ?? "free") ?? (r.sub_plan ?? r.plan ?? "free"),
      periodEnd: r.period_end,
      autoRenew: Boolean(r.auto_renew),
      balance: Number(r.bal ?? 0),
      consumedThisMonth: Number(r.consumed ?? 0),
      pendingPayments: Number(r.pending ?? 0),
    })),
  };
}

/* ------------------------------ 审计 ------------------------------ */

export async function audit(params: {
  actor: SessionUser;
  action: string;
  targetType?: "org" | "user" | "payment";
  targetId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await q(
    `insert into admin_audit_log (id, actor_id, actor_email, action, target_type, target_id, detail)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("aud"),
      params.actor.id,
      params.actor.email,
      params.action,
      params.targetType ?? "org",
      params.targetId ?? "",
      JSON.stringify(params.detail ?? {}),
    ],
  );
}

export async function recentAudit(limit = 40) {
  const rows = await q<{
    id: string;
    actor_email: string;
    action: string;
    target_type: string;
    target_id: string;
    detail: Record<string, unknown>;
    created_at: string;
  }>(
    `select id, actor_email, action, target_type, target_id, detail, created_at
     from admin_audit_log order by created_at desc limit $1`,
    [Math.min(limit, 200)],
  );
  return rows;
}

/* ------------------------------ 调额度 / 改套餐 ------------------------------ */

export async function adminAdjustCredits(params: {
  actor: SessionUser;
  orgId: string;
  delta: number;
  reason: string;
}): Promise<{ balance: number; delta: number }> {
  if (!Number.isInteger(params.delta) || params.delta === 0) {
    throw new AdminError("INVALID_AMOUNT", "调整数量必须是非 0 整数", 422);
  }
  if (!params.reason.trim()) throw new AdminError("REASON_REQUIRED", "请填写调整原因", 422);

  const key = `admin:${newId("adj")}`;
  let result: { balance: number };
  if (params.delta > 0) {
    result = await grantCredits({
      orgId: params.orgId,
      credits: params.delta,
      reason: `管理员发放 · ${params.reason.trim()}`,
      key,
      meta: { by: params.actor.email },
    });
  } else {
    result = await adjustCredits({
      orgId: params.orgId,
      credits: params.delta,
      reason: `管理员扣减 · ${params.reason.trim()}`,
      key,
      meta: { by: params.actor.email },
    });
  }

  await audit({
    actor: params.actor,
    action: "credits.adjust",
    targetType: "org",
    targetId: params.orgId,
    detail: { delta: params.delta, balance: result.balance, reason: params.reason },
  });

  return { balance: result.balance, delta: params.delta };
}

export async function adminChangePlan(params: {
  actor: SessionUser;
  orgId: string;
  planCode: string;
  months?: number;
  bonusCredits?: number;
  reason?: string;
}): Promise<{ subscription: Subscription; planCode: string; granted: number; bonus: number }> {
  const plan = await getPlan(params.planCode);
  if (!plan) throw new AdminError("PLAN_NOT_FOUND", "套餐不存在", 404);

  const months = Math.max(1, Math.min(12, params.months ?? 1));
  const before = await currentSubscription(params.orgId);
  const result = await startSubscription({
    orgId: params.orgId,
    planCode: plan.code,
    months,
    channel: "manual",
  });

  let bonus = 0;
  if (params.bonusCredits && params.bonusCredits > 0) {
    const g = await grantCredits({
      orgId: params.orgId,
      credits: Math.min(params.bonusCredits, 1_000_000),
      reason: `管理员补额 · ${params.reason?.trim() || "套餐调整"}`,
      key: `admin:${newId("bonus")}`,
      meta: { by: params.actor.email, planCode: plan.code },
    });
    bonus = g.applied ? params.bonusCredits : 0;
  }

  await audit({
    actor: params.actor,
    action: "plan.change",
    targetType: "org",
    targetId: params.orgId,
    detail: {
      from: before?.planCode ?? null,
      to: plan.code,
      months,
      granted: result.grantedCredits,
      bonus,
      reason: params.reason ?? "",
    },
  });

  return {
    subscription: result.subscription,
    planCode: plan.code,
    granted: result.grantedCredits,
    bonus,
  };
}

export async function adminStats(): Promise<{
  users: number;
  verifiedUsers: number;
  orgs: number;
  pendingPayments: number;
  pendingAmount: number;
  creditsToday: number;
  gmvThisMonth: number;
}> {
  const row = await q1<{
    users: string;
    verified: string;
    orgs: string;
    pending: string;
    pending_amount: string;
    credits_today: string;
    gmv: string;
  }>(
    `select
       (select count(*) from users)::text as users,
       (select count(*) from users where email_verified_at is not null)::text as verified,
       (select count(*) from organizations)::text as orgs,
       (select count(*) from manual_payments where status = 'pending')::text as pending,
       (select coalesce(sum(amount_cny),0) from manual_payments where status = 'pending')::text as pending_amount,
       (select coalesce(sum(delta),0) from credit_ledger
         where kind = 'grant' and created_at >= date_trunc('day', now()))::text as credits_today,
       (select coalesce(sum(amount_cny),0) from manual_payments
         where status = 'approved' and reviewed_at >= date_trunc('month', now()))::text as gmv`,
  );
  return {
    users: Number(row?.users ?? 0),
    verifiedUsers: Number(row?.verified ?? 0),
    orgs: Number(row?.orgs ?? 0),
    pendingPayments: Number(row?.pending ?? 0),
    pendingAmount: Number(row?.pending_amount ?? 0),
    creditsToday: Number(row?.credits_today ?? 0),
    gmvThisMonth: Number(row?.gmv ?? 0),
  };
}

/** 某租户的积分余额（给管理员页单个用户操作后回显） */
export async function orgBalance(orgId: string): Promise<number> {
  return balance(orgId);
}
