import { fail, ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { userDetail } from "@/lib/manual-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单个用户快照：余额、套餐、最近流水、转账记录 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const detail = await userDetail(id);
  if (!detail) return fail("NOT_FOUND", "用户不存在", 404);
  return ok(detail);
}
