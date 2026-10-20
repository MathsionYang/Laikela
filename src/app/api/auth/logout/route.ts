import { ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await ensureDb();
  await destroySession();
  return ok({ loggedOut: true });
}
