import { ok } from "@/lib/api";
import { ensureDb, q1 } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { summary as creditSummary } from "@/lib/credits";
import { currentSubscription, getPlan, rollPeriodIfNeeded } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 当前登录态。未登录返回 user: null，不报错，方便前端做首屏判断。 */
export async function GET() {
  await ensureDb();
  const session = await getSession();
  if (!session) return ok({ user: null });

  const org = await q1<{ id: string; name: string; plan: string }>(
    `select id, name, plan from organizations where id = $1`,
    [session.orgId],
  );

  await rollPeriodIfNeeded(session.orgId);
  const subscription = await currentSubscription(session.orgId);
  const plan = subscription ? await getPlan(subscription.planCode) : null;
  const credits = await creditSummary(session.orgId);

  return ok({
    user: session,
    org,
    plan,
    subscription,
    credits,
  });
}
