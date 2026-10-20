/**
 * 人工转账充值。
 *
 * 为什么需要它：个人主体拿不到微信/支付宝的收款 API（见 docs/PAYMENT-ACCESS.md），
 * 在拿到个体户资质之前，最诚实的过渡形态是「用户转账 → 提交凭证 → 管理员核对 → 发额度」。
 *
 * 三条设计原则：
 *  1. **金额与权益都由管理员复核时决定**，用户填的只是申报值 —— 防止改前端刷额度
 *  2. **审核是条件更新**（where status='pending'），并发点两次也只会发一次
 *  3. **发放用的幂等键带单号**（manual:<id>:...），重试不会重复入账
 */
import { newId, q, q1 } from "@/lib/db";
import { grant } from "@/lib/credits";
import { getPlan, startSubscription } from "@/lib/billing";
import { audit, listUsers, type AdminUserRow } from "@/lib/admin";
import type { SessionUser } from "@/lib/auth";

export type ManualChannel = "wechat" | "alipay" | "bank";
export type ManualStatus = "pending" | "approved" | "rejected" | "canceled";

export interface ManualPaymentRow {
  id: string;
  org_id: string;
  user_id: string;
  plan_code: string | null;
  months: number;
  amount_cny: string;
  channel: ManualChannel;
  payer_name: string | null;
  transfer_no: string | null;
  note: string | null;
  proof_url: string | null;
  status: ManualStatus;
  credits_granted: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

const MAX_PENDING = 3;

export class PaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function submitClaim(params: {
  session: SessionUser;
  amountCny: number;
  channel: ManualChannel;
  planCode?: string | null;
  months?: number;
  payerName?: string;
  transferNo?: string;
  note?: string;
  proofUrl?: string;
}): Promise<ManualPaymentRow> {
  const amount = Number(params.amountCny);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new PaymentError("INVALID_AMOUNT", "转账金额至少 1 元", 422);
  }
  if (amount > 100_000) throw new PaymentError("INVALID_AMOUNT", "单笔金额过大，请联系管理员", 422);

  const planCode = params.planCode?.trim() || null;
  const months = Math.max(1, Math.min(12, params.months ?? 1));
  if (planCode) {
    const plan = await getPlan(planCode);
    if (!plan) throw new PaymentError("PLAN_NOT_FOUND", "套餐不存在", 404);
  }

  const pending = await q1<{ n: string }>(
    `select count(*)::text as n from manual_payments
     where org_id = $1 and status = 'pending'`,
    [params.session.orgId],
  );
  if (Number(pending?.n ?? 0) >= MAX_PENDING) {
    throw new PaymentError("TOO_MANY_PENDING", "你还有多笔待确认的转账，等管理员处理后再提交", 429);
  }

  // 同一笔转账单号不允许重复申报（防一单多用）
  const transferNo = params.transferNo?.trim() || null;
  if (transferNo) {
    const dup = await q1<{ id: string }>(
      `select id from manual_payments where transfer_no = $1 and status <> 'rejected' limit 1`,
      [transferNo],
    );
    if (dup) throw new PaymentError("DUPLICATE_TRANSFER", "该转账单号已提交过，请勿重复申报", 409);
  }

  const row = await q1<ManualPaymentRow>(
    `insert into manual_payments
       (id, org_id, user_id, plan_code, months, amount_cny, channel, payer_name, transfer_no, note, proof_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      newId("mp"),
      params.session.orgId,
      params.session.id,
      planCode,
      months,
      amount,
      params.channel,
      params.payerName?.trim() || null,
      transferNo,
      params.note?.trim() || null,
      params.proofUrl?.trim() || null,
    ],
  );
  return row as ManualPaymentRow;
}

export async function listOrgClaims(orgId: string, limit = 20): Promise<ManualPaymentRow[]> {
  return q<ManualPaymentRow>(
    `select * from manual_payments where org_id = $1 order by created_at desc limit $2`,
    [orgId, Math.min(limit, 100)],
  );
}

export async function cancelClaim(params: { session: SessionUser; id: string }): Promise<void> {
  const row = await q1<ManualPaymentRow>(
    `select * from manual_payments where id = $1 limit 1`,
    [params.id],
  );
  if (!row) throw new PaymentError("NOT_FOUND", "记录不存在", 404);
  if (row.org_id !== params.session.orgId) throw new PaymentError("FORBIDDEN", "无权操作", 403);
  if (row.status !== "pending") throw new PaymentError("NOT_PENDING", "该笔已在处理中，无法撤销", 409);

  await q(
    `update manual_payments set status = 'canceled', review_note = '用户主动撤销'
     where id = $1 and status = 'pending'`,
    [params.id],
  );
}

export interface AdminClaimRow extends ManualPaymentRow {
  user_email: string;
  user_name: string;
  org_name: string;
}

export async function listAllClaims(params: {
  status?: ManualStatus | "all";
  limit?: number;
}): Promise<AdminClaimRow[]> {
  const status = params.status ?? "pending";
  return q<AdminClaimRow>(
    `select mp.*, u.email as user_email, u.name as user_name, o.name as org_name
     from manual_payments mp
     join users u on u.id = mp.user_id
     join organizations o on o.id = mp.org_id
     where ($1 = 'all' or mp.status = $1)
     order by mp.created_at desc
     limit $2`,
    [status, Math.min(params.limit ?? 60, 200)],
  );
}

/**
 * 审核。通过时可以同时：开/续套餐、直接加积分。
 * 两者独立 —— 套餐的月度积分按自然月发放（同月重复开通不重复发），
 * 想在这个之外补额，就填 bonusCredits。
 */
export async function reviewClaim(params: {
  actor: SessionUser;
  id: string;
  action: "approve" | "reject";
  planCode?: string | null;
  months?: number;
  bonusCredits?: number;
  note?: string;
}): Promise<{
  status: ManualStatus;
  creditsGranted: number;
  bonusCredits: number;
  planCode: string | null;
}> {
  const claim = await q1<ManualPaymentRow>(
    `select * from manual_payments where id = $1 limit 1`,
    [params.id],
  );
  if (!claim) throw new PaymentError("NOT_FOUND", "记录不存在", 404);

  const note = params.note?.trim() || null;

  if (params.action === "reject") {
    const updated = await q<{ id: string }>(
      `update manual_payments
       set status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
       where id = $1 and status = 'pending' returning id`,
      [params.id, params.actor.email, note],
    );
    if (!updated.length) throw new PaymentError("ALREADY_REVIEWED", "该笔已处理过", 409);

    await audit({
      actor: params.actor,
      action: "payment.reject",
      targetType: "payment",
      targetId: params.id,
      detail: { orgId: claim.org_id, amount: Number(claim.amount_cny), note },
    });
    return { status: "rejected", creditsGranted: 0, bonusCredits: 0, planCode: null };
  }

  // 先抢占状态：并发点两次「通过」只有一个能成功
  const claimed = await q<{ id: string }>(
    `update manual_payments
     set status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3
     where id = $1 and status = 'pending' returning id`,
    [params.id, params.actor.email, note],
  );
  if (!claimed.length) throw new PaymentError("ALREADY_REVIEWED", "该笔已处理过", 409);

  // 套餐：单子上的优先，管理员可临时改
  const planCode = (params.planCode ?? claim.plan_code ?? "").trim() || null;
  const months = Math.max(1, Math.min(12, params.months ?? claim.months ?? 1));

  let subscriptionGranted = 0;
  if (planCode) {
    const plan = await getPlan(planCode);
    if (!plan) throw new PaymentError("PLAN_NOT_FOUND", "套餐不存在", 404);
    const res = await startSubscription({
      orgId: claim.org_id,
      planCode,
      months,
      channel: "manual",
    });
    subscriptionGranted = res.grantedCredits;
  }

  let bonus = 0;
  const wantBonus = Math.max(0, Math.min(params.bonusCredits ?? 0, 1_000_000));
  if (wantBonus > 0) {
    const g = await grant({
      orgId: claim.org_id,
      credits: wantBonus,
      reason: `转账充值 · ${claim.id}`,
      // 幂等键带单号：重复审核也不会重复入账
      key: `manual:${claim.id}:bonus`,
      meta: { reviewBy: params.actor.email, amount: Number(claim.amount_cny) },
    });
    bonus = g.applied ? wantBonus : 0;
  }

  const total = subscriptionGranted + bonus;
  await q(`update manual_payments set credits_granted = $2 where id = $1`, [claim.id, total]);

  await audit({
    actor: params.actor,
    action: "payment.approve",
    targetType: "payment",
    targetId: claim.id,
    detail: {
      orgId: claim.org_id,
      amount: Number(claim.amount_cny),
      planCode,
      months,
      subscriptionGranted,
      bonus,
      note,
    },
  });

  return { status: "approved", creditsGranted: total, bonusCredits: bonus, planCode };
}

/** 管理端：某用户的一页快照（点开用户卡片时用） */
export interface AdminUserDetail {
  user: AdminUserRow;
  ledger: Array<{ id: string; kind: string; delta: number; reason: string; created_at: string }>;
  claims: ManualPaymentRow[];
}

export async function userDetail(userId: string): Promise<AdminUserDetail | null> {
  const { rows } = await listUsers({ userId, limit: 1 });
  const target = rows[0];
  if (!target) return null;

  const ledger = await q<{
    id: string;
    kind: string;
    delta: number;
    reason: string;
    created_at: string;
  }>(
    `select id, kind, delta, reason, created_at from credit_ledger
     where org_id = $1 order by created_at desc limit 20`,
    [target.orgId],
  );

  return {
    user: target,
    ledger: ledger.map((l) => ({ ...l, delta: Number(l.delta) })),
    claims: await listOrgClaims(target.orgId, 10),
  };
}
