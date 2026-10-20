import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { reviewClaim, PaymentError } from "@/lib/manual-payments";
import { AdminError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审核转账：通过时开/续套餐 + 可选补积分；驳回只留痕 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const body = await readJson<{
    action?: "approve" | "reject";
    planCode?: string | null;
    months?: number;
    bonusCredits?: number;
    note?: string;
  }>(req);

  if (body.action !== "approve" && body.action !== "reject") {
    return fail("INVALID_ACTION", "action 只能是 approve 或 reject", 422);
  }

  try {
    const result = await reviewClaim({
      actor: guard.session,
      id,
      action: body.action,
      planCode: body.planCode ?? null,
      months: Number(body.months ?? 1),
      bonusCredits: Number(body.bonusCredits ?? 0),
      note: body.note,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof PaymentError) return fail(err.code, err.message, err.status);
    if (err instanceof AdminError) return fail(err.code, err.message, err.status);
    console.error("[admin/payments/review]", err);
    return fail("INTERNAL", "审核失败", 500);
  }
}
