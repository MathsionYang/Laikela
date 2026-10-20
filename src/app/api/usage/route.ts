import { ok } from "@/lib/api";
import { ensureDb, q } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { usageSummary } from "@/lib/jobs/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const summary = await usageSummary(session.orgId);

  const byTool = await q<{ tool_slug: string; runs: string; cost: string }>(
    `select j.tool_slug, count(*)::text as runs, coalesce(sum(j.cost_cny),0)::text as cost
     from jobs j
     where j.org_id = $1 and j.created_at >= date_trunc('month', now())
     group by j.tool_slug order by count(*) desc`,
    [session.orgId],
  );

  const daily = await q<{ day: string; runs: string; cost: string }>(
    `select to_char(d.day, 'MM-DD') as day,
            coalesce(count(j.id), 0)::text as runs,
            coalesce(sum(j.cost_cny), 0)::text as cost
     from generate_series(current_date - interval '29 days', current_date, interval '1 day') as d(day)
     left join jobs j on j.org_id = $1 and j.status = 'succeeded' and j.created_at::date = d.day
     group by d.day order by d.day`,
    [session.orgId],
  );

  return ok({
    ...summary,
    remaining: Math.max(0, summary.quota - summary.monthCredits),
    byTool: byTool.map((r) => ({ tool: r.tool_slug, runs: Number(r.runs), cost: Number(r.cost) })),
    daily: daily.map((r) => ({ day: r.day, runs: Number(r.runs), cost: Number(r.cost) })),
  });
}
