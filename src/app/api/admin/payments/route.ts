import type { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { listAllClaims, type ManualStatus } from "@/lib/manual-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 全部转账认领单，默认只看待审 */
export async function GET(req: NextRequest) {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;

  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") ?? "pending") as ManualStatus | "all";
  const limit = Number(sp.get("limit") ?? 60);
  return ok({ rows: await listAllClaims({ status, limit }) });
}
