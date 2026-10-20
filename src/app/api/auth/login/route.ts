import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { AuthError, login } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body.email || !body.password) {
    return fail("MISSING_FIELDS", "请填写邮箱与密码", 422);
  }

  try {
    const user = await login({
      email: body.email,
      password: body.password,
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return ok({ user });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code, err.message, err.status, err.detail);
    console.error("[auth/login]", err);
    return fail("INTERNAL", "登录失败，请稍后再试", 500);
  }
}
