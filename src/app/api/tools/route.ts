import { ok } from "@/lib/api";
import { ensureDb, q } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { SECTIONS, TOOLS } from "@/lib/domain/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  // 每个工具的使用次数与最近一次成功时间，用于卡片角标
  const stats = await q<{ tool_slug: string; runs: string; last_at: string | null }>(
    `select tool_slug, count(*)::text as runs, max(created_at)::text as last_at
     from jobs where org_id = $1 and status = 'succeeded'
     group by tool_slug`,
    [session.orgId],
  );
  const byTool = new Map(stats.map((s) => [s.tool_slug, s]));

  const enabled = await q<{ slug: string; enabled: boolean }>(
    `select slug, enabled from tool_definitions`,
  );
  const enabledMap = new Map(enabled.map((r) => [r.slug, r.enabled]));

  return ok({
    sections: SECTIONS,
    tools: TOOLS.map((t) => ({
      ...t,
      enabled: enabledMap.get(t.slug) !== false,
      runs: Number(byTool.get(t.slug)?.runs ?? 0),
      lastRunAt: byTool.get(t.slug)?.last_at ?? null,
    })),
  });
}
