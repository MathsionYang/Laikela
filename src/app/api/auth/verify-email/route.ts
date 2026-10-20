import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { consumeVerification } from "@/lib/email-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 注册第二步：校验验证码，成功才建会话。 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await readJson<{ email?: string; code?: string }>(req);
  if (!body.email || !body.code) {
    return fail("MISSING_FIELDS", "请填写邮箱与验证码", 422);
  }

  try {
    const { user } = await consumeVerification({
      email: body.email,
      code: body.code,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });
    return ok({ user, verified: true });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code, err.message, err.status, err.detail);
    console.error("[auth/verify-email]", err);
    return fail("INTERNAL", "验证失败，请稍后再试", 500);
  }
}
