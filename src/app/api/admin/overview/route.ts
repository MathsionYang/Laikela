import { fail, ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { adminStats, recentAudit } from "@/lib/admin";
import { listAllClaims } from "@/lib/manual-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 管理台首屏：统计 + 待审转账 + 最近操作 */
export async function GET() {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;
  if (!guard.session.isAdmin) return fail("FORBIDDEN", "需要平台管理员权限", 403);

  const [stats, audit, pending] = await Promise.all([
    adminStats(),
    recentAudit(30),
    listAllClaims({ status: "pending", limit: 30 }),
  ]);

  return ok({ stats, audit, pending });
}
