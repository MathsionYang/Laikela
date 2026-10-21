/**
 * 订阅与计费。
 *
 * 套餐维度：月付价格 / 每月积分 / 席位数 / 功能开关。
 * 订阅与积分分开：订阅决定「每月发多少积分」，积分决定「一次任务扣多少」。
 * 这样调整单价不会影响已售套餐，也方便做活动赠积分。
 *
 * 支付：演示环境用 mock 通道直接置 paid；接真实支付时只需把
 * `payOrder()` 换成微信支付/支付宝下单，并由支付回调调用 `fulfillOrder()`。
 */
import { newId, q, q1, tx } from "@/lib/db";
import {
  grant,
  topUpMonthly,
  summary as creditSummary,
  type LedgerRow,
  ledger,
} from "@/lib/credits";

export interface PlanRow {
  code: string;
  name: string;
  tagline: string;
  price_cny: string;
  monthly_credits: number;
  seats: number;
  features: string[];
  sort: number;
}

export interface SubscriptionRow {
  id: string;
  org_id: string;
  plan_code: string;
  status: string;
  seats: number;
  price_cny: string;
  period_start: string;
  period_end: string;
  cancel_at_period_end: boolean;
  auto_renew: boolean;
  order_no: string | null;
  created_at: string;
}

export interface Plan {
  code: string;
  name: string;
  tagline: string;
  priceCny: number;
  monthlyCredits: number;
  seats: number;
  features: string[];
  sort: number;
}

export interface Subscription {
  id: string;
  orgId: string;
  planCode: string;
  status: string;
  seats: number;
  priceCny: number;
  periodStart: string;
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  autoRenew: boolean;
  orderNo: string | null;
}

const toPlan = (r: PlanRow): Plan => ({
  code: r.code,
  name: r.name,
  tagline: r.tagline,
  priceCny: Number(r.price_cny),
  monthlyCredits: Number(r.monthly_credits),
  seats: Number(r.seats),
  features: Array.isArray(r.features) ? r.features : [],
  sort: Number(r.sort ?? 0),
});

const toSub = (r: SubscriptionRow): Subscription => ({
  id: r.id,
  orgId: r.org_id,
  planCode: r.plan_code,
  status: r.status,
  seats: Number(r.seats),
  priceCny: Number(r.price_cny),
  periodStart: r.period_start,
  periodEnd: r.period_end,
  cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
  autoRenew: Boolean(r.auto_renew),
  orderNo: r.order_no,
});

export async function listPlans(): Promise<Plan[]> {
  const rows = await q<PlanRow>(
    `select * from plans where active = true order by sort asc, price_cny asc`,
  );
  return rows.map(toPlan);
}

export async function getPlan(code: string): Promise<Plan | null> {
  const row = await q1<PlanRow>(`select * from plans where code = $1`, [code]);
  return row ? toPlan(row) : null;
}

export async function currentSubscription(orgId: string): Promise<Subscription | null> {
  const row = await q1<SubscriptionRow>(
    `select * from subscriptions where org_id = $1 and status = 'active' order by created_at desc limit 1`,
    [orgId],
  );
  return row ? toSub(row) : null;
}

/**
 * 当前生效套餐的 code。没有订阅时视为 free。
 * 路由模型前先调它：套餐到期没续的用户不该继续用付费模型。
 */
export async function planCodeOf(orgId: string): Promise<string> {
  const sub = await rollPeriodIfNeeded(orgId);
  return sub?.planCode ?? "free";
}

/** 到期自动续期：补发下一期积分，并把周期往后滚 */
export async function rollPeriodIfNeeded(orgId: string): Promise<Subscription | null> {
  const sub = await currentSubscription(orgId);
  if (!sub) return null;
  if (new Date(sub.periodEnd).getTime() > Date.now()) return sub;

  const plan = await getPlan(sub.planCode);
  if (!plan) return sub;

  if (!sub.autoRenew) {
    await q(`update subscriptions set status = 'expired', updated_at = now() where id = $1`, [sub.id]);
    return null;
  }

  const nextStart = new Date(sub.periodEnd);
  const nextEnd = addMonths(nextStart, 1);
  const orderNo = `RN${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

  await tx(async (c) => {
    await c.query(
      `update subscriptions set period_start = $2, period_end = $3, order_no = $4, updated_at = now() where id = $1`,
      [sub.id, nextStart, nextEnd, orderNo],
    );
    await c.query(
      `insert into orders (id, org_id, plan_code, amount_cny, months, status, channel, out_trade_no, paid_at)
       values ($1,$2,$3,$4,1,'paid','auto',$5,now())`,
      [newId("ord"), orgId, plan.code, plan.priceCny, orderNo],
    );
  });

  await grant({
    orgId,
    credits: plan.monthlyCredits,
    reason: `${plan.name} · ${monthLabel(nextStart)} 月度积分`,
    key: `grant:${orgId}:${monthKey(nextStart)}`,
    meta: { planCode: plan.code, period: monthKey(nextStart), auto: true },
  });

  return currentSubscription(orgId);
}

/**
 * 开通/升级订阅。
 * 已存在 active 订阅时：旧订阅标记 canceled，新订阅立即生效（剩余天数按比例不退，演示环境简化）。
 */
export async function startSubscription(params: {
  orgId: string;
  planCode: string;
  months?: number;
  channel?: "mock" | "wechat" | "alipay" | "manual" | "system";
}): Promise<{ subscription: Subscription; plan: Plan; orderNo: string; grantedCredits: number }> {
  const plan = await getPlan(params.planCode);
  if (!plan) throw new Error(`套餐不存在：${params.planCode}`);

  const months = Math.max(1, Math.min(12, params.months ?? 1));
  const now = new Date();
  const end = addMonths(now, months);
  const orderNo = `LK${now.getTime()}${Math.floor(Math.random() * 900 + 100)}`;
  const subId = newId("sub");
  const amount = plan.priceCny * months;

  await tx(async (c) => {
    // 同一租户只允许一条 active（部分唯一索引兜底）
    await c.query(
      `update subscriptions set status = 'canceled', updated_at = now()
       where org_id = $1 and status = 'active'`,
      [params.orgId],
    );
    await c.query(
      `insert into subscriptions
         (id, org_id, plan_code, status, seats, price_cny, period_start, period_end, order_no)
       values ($1,$2,$3,'active',$4,$5,$6,$7,$8)`,
      [subId, params.orgId, plan.code, plan.seats, amount, now, end, orderNo],
    );
    await c.query(
      `insert into orders (id, org_id, plan_code, amount_cny, months, status, channel, out_trade_no, paid_at)
       values ($1,$2,$3,$4,$5,'paid',$6,$7,now())`,
      // 走到这里说明钱已确认（mock 本机演示，或管理员审核通过的人工转账），
      // 所以订单直接记 paid —— 之前写的是 `amount > 0 ? "paid" : "paid"`，两个分支一样，纯属占位。
      [newId("ord"), params.orgId, plan.code, amount, months, params.channel ?? "manual", orderNo],
    );
    await c.query(`update organizations set plan = $2, quota_month = $3 where id = $1`, [
      params.orgId,
      plan.code,
      plan.monthlyCredits,
    ]);
  });

  // 积分按「自然月应得总额」发放：本月已发多少就补多少差额。
  // 这样 free(200) 升 enterprise(95,000) 能拿到剩下的 94,800，
  // 而同月反复升降级因为「已发已达目标」不会重复拿（防刷额度）。
  const topup = await topUpMonthly({
    orgId: params.orgId,
    target: plan.monthlyCredits,
    reason: `${plan.name} · ${monthLabel(now)} 订阅发放`,
    key: `grant:${params.orgId}:${monthKey(now)}:${plan.code}`,
    meta: { planCode: plan.code, orderNo, months },
  });

  const subscription = await currentSubscription(params.orgId);
  return {
    subscription: subscription as Subscription,
    plan,
    orderNo,
    grantedCredits: topup.granted,
  };
}

/** 取消自动续订：当期不退款，到期后不再扣费 */
export async function cancelSubscription(orgId: string): Promise<Subscription | null> {
  await q(
    `update subscriptions set cancel_at_period_end = true, auto_renew = false, updated_at = now()
     where org_id = $1 and status = 'active'`,
    [orgId],
  );
  return currentSubscription(orgId);
}

/** 恢复自动续订 */
export async function resumeSubscription(orgId: string): Promise<Subscription | null> {
  await q(
    `update subscriptions set cancel_at_period_end = false, auto_renew = true, updated_at = now()
     where org_id = $1 and status = 'active'`,
    [orgId],
  );
  return currentSubscription(orgId);
}

export interface BillingOverview {
  plan: Plan | null;
  subscription: Subscription | null;
  credits: Awaited<ReturnType<typeof creditSummary>>;
  ledger: Array<Omit<LedgerRow, "meta"> & { meta: Record<string, unknown> }>;
  plans: Plan[];
}

export async function billingOverview(orgId: string): Promise<BillingOverview> {
  const subscription = await rollPeriodIfNeeded(orgId);
  const plan = subscription ? await getPlan(subscription.planCode) : null;
  const [credits, entries, plans] = await Promise.all([
    creditSummary(orgId),
    ledger(orgId, 25),
    listPlans(),
  ]);
  return { plan, subscription, credits, ledger: entries, plans };
}

/* ------------------------------ 日期工具 ------------------------------ */

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  const day = out.getDate();
  out.setMonth(out.getMonth() + n);
  // 处理 1/31 → 2/28 这类溢出
  if (out.getDate() < day) out.setDate(0);
  return out;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d: Date) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
