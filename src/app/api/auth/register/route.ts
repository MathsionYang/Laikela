import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { AuthError, register } from "@/lib/auth";
import { issueVerification } from "@/lib/email-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 注册第一步：建账号 + 发验证码，**不发会话**。
 * 真正登录发生在 POST /api/auth/verify-email 校验通过之后。
 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const body = await readJson<{
    email?: string;
    password?: string;
    name?: string;
    orgName?: string;
  }>(req);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent");

  try {
    const user = await register({
      email: body.email ?? "",
      password: body.password ?? "",
      name: body.name ?? "",
      orgName: body.orgName,
    });

    const issued = await issueVerification({
      userId: user.id,
      email: user.email,
      ip,
      userAgent: ua,
    });

    return ok(
      {
        pending: true as const,
        email: user.email,
        expiresAt: issued.expiresAt,
        // 未配 SMTP 时后端把码透出来，本机自测不用真收信；生产恒为 null
        devCode: issued.devCode,
        mailDriver: issued.driver,
        warning: issued.warning,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code, err.message, err.status, err.detail);
    console.error("[auth/register]", err);
    return fail("INTERNAL", "注册失败，请稍后再试", 500);
  }
}
