import { ok, readJson } from "@/lib/api";
import { ensureDb, q } from "@/lib/db";
import { requireSession } from "@/lib/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 热点查询。
 * 当前返回 seed 里的示例事件，字段结构与真实采集器一致
 * （platform / keyword / heat / growth / confidence / source / captured_at），
 * 接入采集器后只需把 source 换成真实来源，前端无需改动。
 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const body = await readJson<{ platform?: string; keyword?: string; limit?: number }>(req);
  const limit = Math.min(body.limit ?? 20, 100);

  const where: string[] = ["org_id = $1"];
  const vals: unknown[] = [session.orgId];
  let i = 2;
  if (body.platform) {
    where.push(`platform = $${i++}`);
    vals.push(body.platform);
  }
  if (body.keyword) {
    where.push(`keyword ilike $${i++}`);
    vals.push(`%${body.keyword}%`);
  }
  vals.push(limit);

  const rows = await q<{
    id: string;
    platform: string;
    keyword: string;
    heat: string;
    growth: string;
    confidence: string;
    source: string;
    captured_at: string;
  }>(
    `select id, platform, keyword, heat::text, growth::text, confidence::text, source, captured_at::text
     from trend_events where ${where.join(" and ")}
     order by growth desc, heat desc limit $${i}`,
    vals,
  );

  return ok({
    items: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      keyword: r.keyword,
      heat: Number(r.heat),
      growth: Number(r.growth),
      confidence: Number(r.confidence),
      source: r.source,
      capturedAt: r.captured_at,
    })),
    notice:
      rows.every((r) => r.source === "sample")
        ? "示例数据：接入采集器后 source 会变为真实来源，字段结构不变"
        : undefined,
  });
}
