import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session-api";
import { billingOverview, cancelSubscription, resumeSubscription, startSubscription } from "@/lib/billing";
import { audit } from "@/lib/jobs/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const overview = await billingOverview(guard.session.orgId);
  return ok(overview);
}

/** 开通 / 升级 / 降级：同一时刻只保留一条 active 订阅 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await readJson<{ planCode?: string; months?: number; channel?: "mock" | "wechat" | "alipay" | "manual" }>(req);
  if (!body.planCode) return fail("NO_PLAN", "请选择套餐", 422);

  // 线上不允许「下单即到账」的假支付：mock 通道默认关闭。
  // 微信/支付宝尚未接入，自助开通一律拒绝，引导走「人工转账 → 管理员审核」。
  const channel = body.channel ?? "mock";
  if (channel !== "mock" || !env.payment.mock) {
    return fail(
      "PAYMENT_NOT_READY",
      "在线支付尚未接入。请在「充值」页提交人工转账单号，管理员核对到账后为你开通套餐并发放积分。",
      409,
    );
  }

  try {
    const result = await startSubscription({
      orgId: session.orgId,
      planCode: body.planCode,
      months: body.months ?? 1,
      channel,
    });
    await audit({
      orgId: session.orgId,
      action: "subscription.started",
      target: result.subscription.id,
      detail: { plan: result.plan.code, orderNo: result.orderNo, granted: result.grantedCredits },
    });
    return ok(result, { status: 201 });
  } catch (err) {
    return fail("SUBSCRIBE_FAILED", (err as Error).message, 400);
  }
}

/** 取消 / 恢复自动续订 */
export async function PATCH(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await readJson<{ action?: "cancel" | "resume" }>(req);
  if (body.action === "resume") {
    const sub = await resumeSubscription(session.orgId);
    await audit({ orgId: session.orgId, action: "subscription.resumed", target: sub?.id });
    return ok({ subscription: sub });
  }
  const sub = await cancelSubscription(session.orgId);
  await audit({ orgId: session.orgId, action: "subscription.canceled", target: sub?.id });
  return ok({ subscription: sub });
}
