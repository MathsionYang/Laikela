import type { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session-api";
import { listUsers } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用户列表：支持按邮箱/称呼/空间名搜索 */
export async function GET(req: NextRequest) {
  await ensureDb();
  const guard = await requireAdminSession();
  if ("error" in guard) return guard.error;

  const sp = req.nextUrl.searchParams;
  const result = await listUsers({
    keyword: sp.get("q") ?? "",
    limit: Number(sp.get("limit") ?? 50),
    offset: Number(sp.get("offset") ?? 0),
  });
  return ok(result);
}
