import { ok } from "@/lib/api";
import { ensureDb, q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { usageSummary } from "@/lib/jobs/repo";
import { summary as creditSummary } from "@/lib/credits";
import { getPlan, rollPeriodIfNeeded } from "@/lib/billing";
import { clientJob } from "@/lib/jobs/serialize";
import type { JobRow } from "@/lib/jobs/repo";

async function currentSubscriptionPlan(orgId: string) {
  const { currentSubscription } = await import("@/lib/billing");
  const subscription = await currentSubscription(orgId);
  return subscription ? getPlan(subscription.planCode) : null;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const totals = await q1<{
    month_runs: string;
    today_runs: string;
    running: string;
    total_runs: string;
    failed: string;
  }>(
    `select
       count(*) filter (where status='succeeded' and created_at >= date_trunc('month', now()))::text as month_runs,
       count(*) filter (where created_at::date = current_date)::text as today_runs,
       count(*) filter (where status in ('queued','running','post_processing','reviewing'))::text as running,
       count(*)::text as total_runs,
       count(*) filter (where status='failed')::text as failed
     from jobs where org_id = $1`,
    [session.orgId],
  );

  const daily = await q<{ day: string; runs: string; cost: string }>(
    `select to_char(d.day, 'MM-DD') as day,
            coalesce(count(j.id), 0)::text as runs,
            coalesce(sum(j.cost_cny), 0)::text as cost
     from generate_series(current_date - interval '29 days', current_date, interval '1 day') as d(day)
     left join jobs j on j.org_id = $1 and j.status='succeeded' and j.created_at::date = d.day
     group by d.day order by d.day`,
    [session.orgId],
  );

  const recent = await q<JobRow>(
    `select * from jobs where org_id = $1 order by created_at desc limit 6`,
    [session.orgId],
  );

  const trends = await q<{
    platform: string;
    keyword: string;
    heat: string;
    growth: string;
    captured_at: string;
  }>(
    `select platform, keyword, heat::text, growth::text, captured_at::text
     from trend_events where org_id = $1 order by growth desc limit 5`,
    [session.orgId],
  );

  const modStats = await q1<{ pass: string; total: string }>(
    `select
       count(*) filter (where level <> 'block')::text as pass,
       count(*)::text as total
     from moderation_records where org_id = $1`,
    [session.orgId],
  );

  const usage = await usageSummary(session.orgId);
  // 额度以积分账户为准（订阅发放 → 任务扣减 → 失败退回）
  await rollPeriodIfNeeded(session.orgId);
  const credits = await creditSummary(session.orgId);
  const sub = await currentSubscriptionPlan(session.orgId);
  const quota = sub?.monthlyCredits ?? usage.quota;
  const totalRuns = Number(totals?.total_runs ?? 0);
  const failed = Number(totals?.failed ?? 0);

  return ok({
    metrics: {
      monthRuns: Number(totals?.month_runs ?? 0),
      todayRuns: Number(totals?.today_runs ?? 0),
      running: Number(totals?.running ?? 0),
      successRate: totalRuns ? 1 - failed / totalRuns : 1,
      passRate: Number(modStats?.total ?? 0)
        ? Number(modStats?.pass ?? 0) / Number(modStats?.total ?? 1)
        : 1,
      remaining: Math.max(0, credits.balance),
      quota,
      creditsSpent: credits.consumedThisMonth,
      creditsRefunded: credits.refundedThisMonth,
      monthCost: usage.monthCost,
    },
    daily: daily.map((r) => ({ day: r.day, runs: Number(r.runs), cost: Number(r.cost) })),
    recent: recent.map(clientJob),
    trends: trends.map((t) => ({
      platform: t.platform,
      keyword: t.keyword,
      heat: Number(t.heat),
      growth: Number(t.growth),
      capturedAt: t.captured_at,
    })),
  });
}
