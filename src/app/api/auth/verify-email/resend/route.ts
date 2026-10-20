import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { resendVerification } from "@/lib/email-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 重发验证码。不区分"邮箱不存在/已验证"，一律回同一句话，避免账号枚举。 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await readJson<{ email?: string }>(req);
  if (!body.email) return fail("MISSING_FIELDS", "请填写邮箱", 422);

  try {
    const result = await resendVerification({
      email: body.email,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });
    return ok({
      ...result,
      message: result.sent
        ? "验证码已重新发送，请查收邮箱"
        : "如果该邮箱还差一步验证，验证码已发出",
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code, err.message, err.status, err.detail);
    console.error("[auth/verify-email/resend]", err);
    return fail("INTERNAL", "发送失败，请稍后再试", 500);
  }
}
