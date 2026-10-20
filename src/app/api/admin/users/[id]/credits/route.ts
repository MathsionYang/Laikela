import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb, q1 } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { adminAdjustCredits, AdminError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 手动调额度：正数发放、负数扣减，全部写进积分账本并留审计 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const body = await readJson<{ delta?: number; reason?: string }>(req);

  const user = await q1<{ org_id: string }>(`select org_id from users where id = $1`, [id]);
  if (!user) return fail("NOT_FOUND", "用户不存在", 404);

  try {
    const result = await adminAdjustCredits({
      actor: guard.session,
      orgId: user.org_id,
      delta: Number(body.delta ?? 0),
      reason: body.reason ?? "",
    });
    return ok(result);
  } catch (err) {
    if (err instanceof AdminError) return fail(err.code, err.message, err.status, err.detail);
    const e = err as Error & { code?: string; status?: number };
    if (e.code === "INSUFFICIENT_CREDITS" || e.code === "INVALID_AMOUNT") {
      return fail(e.code, e.message, e.status ?? 422);
    }
    console.error("[admin/users/credits]", err);
    return fail("INTERNAL", "调整失败", 500);
  }
}
