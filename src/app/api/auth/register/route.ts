import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { AuthError, register } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await readJson<{
    email?: string;
    password?: string;
    name?: string;
    orgName?: string;
  }>(req);

  try {
    const user = await register({
      email: body.email ?? "",
      password: body.password ?? "",
      name: body.name ?? "",
      orgName: body.orgName,
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return ok({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code, err.message, err.status);
    console.error("[auth/register]", err);
    return fail("INTERNAL", "注册失败，请稍后再试", 500);
  }
}
