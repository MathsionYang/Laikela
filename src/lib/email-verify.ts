/**
 * 注册邮箱验证。
 *
 * 设计取舍：
 *  - **验证码而不是魔法链接**：链接要求域名可达、邮件客户端不预取（很多企业邮箱会预取链接，
 *    一点就自动验证了别人的号），验证码没有这个问题，也不依赖公网域名。
 *  - **6 位纯数字**：空间只有 100 万，所以库里不存明文也不存裸 sha256（离线可爆破），
 *    用 `HMAC-SHA256(serverSecret, userId:code)`；拿到库也反推不出可用码。
 *  - **冷却与次数落库**：不引入 Redis，单机与多实例行为一致。
 *  - **验证成功才建会话**：注册接口不再直接发 cookie，未验证的会话一个都不存在。
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { newId, q, q1 } from "@/lib/db";
import { AuthError, createSession, type SessionUser } from "@/lib/auth";
import { sendMail } from "@/lib/mail";

export type VerifyPurpose = "register";

const hashCode = (userId: string, code: string) =>
  createHmac("sha256", env.signingSecret).update(`${userId}:${code}`).digest("hex");

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export interface IssuedCode {
  expiresAt: string;
  /** outbox 驱动（未配 SMTP）时回传给前端，方便本机自测；生产恒为 null */
  devCode: string | null;
  driver: "smtp" | "outbox";
  /** SMTP 投递失败时的原因，前端可据此提示"邮件可能延迟" */
  warning: string | null;
}

export async function issueVerification(params: {
  userId: string;
  email: string;
  purpose?: VerifyPurpose;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<IssuedCode> {
  const purpose = params.purpose ?? "register";

  // 冷却：同一账号 60 秒内只发一封
  const last = await q1<{ created_at: string }>(
    `select created_at from email_verifications
     where user_id = $1 and purpose = $2 order by created_at desc limit 1`,
    [params.userId, purpose],
  );
  if (last && env.verify.required) {
    const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (elapsed < env.verify.resendCooldownSec) {
      const wait = Math.ceil(env.verify.resendCooldownSec - elapsed);
      throw new AuthError("CODE_COOLDOWN", `发送太频繁，请 ${wait} 秒后再试`, 429);
    }
  }

  // 小时配额：防止被拿去当"免费邮件炮台"
  const cap = await q1<{ n: string }>(
    `select count(*)::text as n from email_verifications
     where email = $1 and created_at > now() - interval '1 hour'`,
    [params.email],
  );
  if (Number(cap?.n ?? 0) >= env.verify.hourlyCap) {
    throw new AuthError("TOO_MANY_CODES", "该邮箱 1 小时内验证码发送次数过多，请稍后再试", 429);
  }

  const code = newCode();
  const expires = new Date(Date.now() + env.verify.ttlMinutes * 60 * 1000);

  // 旧码作废：只认最新一封，避免新码旧码都能用
  await q(
    `update email_verifications set consumed_at = now()
     where user_id = $1 and purpose = $2 and consumed_at is null`,
    [params.userId, purpose],
  );
  await q(
    `insert into email_verifications
       (id, user_id, email, purpose, code_hash, expires_at, ip, user_agent)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      newId("ver"),
      params.userId,
      params.email,
      purpose,
      hashCode(params.userId, code),
      expires,
      params.ip ?? null,
      params.userAgent ?? null,
    ],
  );

  const mail = await sendMail({
    to: params.email,
    subject: `【${env.appName}】注册验证码 ${code}（${env.verify.ttlMinutes} 分钟内有效）`,
    text:
      `你正在注册${env.appName}（${env.appSub}）。\n\n` +
      `验证码：${code}\n` +
      `有效期：${env.verify.ttlMinutes} 分钟，最多尝试 ${env.verify.maxAttempts} 次。\n\n` +
      `这条验证码只用于完成注册，不会用于其他用途。\n` +
      `如果不是你本人操作，忽略本邮件即可，账号不会被创建。\n\n` +
      `—— ${env.appName}`,
    html:
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">` +
      `<p style="font-size:14px;line-height:1.7">你正在注册<b>${env.appName}</b>（${env.appSub}）。</p>` +
      `<p style="margin:22px 0;padding:18px 0;text-align:center;background:#0d0f12;border-radius:10px;color:#d8a85e;` +
      `font-size:30px;letter-spacing:10px;font-weight:600;font-family:ui-monospace,Menlo,monospace">${code}</p>` +
      `<p style="font-size:13px;line-height:1.7;color:#555">有效期 ${env.verify.ttlMinutes} 分钟，最多尝试 ${env.verify.maxAttempts} 次。<br>` +
      `如果不是你本人操作，忽略本邮件即可，账号不会被创建。</p>` +
      `<p style="margin-top:26px;font-size:12px;color:#999">—— ${env.appName} · ${env.appSub}</p>` +
      `</div>`,
  });

  return {
    expiresAt: expires.toISOString(),
    /**
     * 只有「没配 SMTP（走 outbox）+ 非生产」才把码回给前端，
     * 生产环境哪怕忘了配 SMTP 也不会把码泄漏在响应里；
     * 本地跑 `next start` 做端到端测试时用 MAIL_DEBUG_CODE=1 显式打开。
     */
    devCode:
      mail.driver === "outbox" &&
      (process.env.NODE_ENV !== "production" || process.env.MAIL_DEBUG_CODE === "1")
        ? code
        : null,
    driver: mail.driver,
    warning: mail.error,
  };
}

export interface VerifyResult {
  user: SessionUser;
}

/** 校验验证码 → 置已验证 → 建会话。成功后前端直接进工作台。 */
export async function consumeVerification(params: {
  email: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
  purpose?: VerifyPurpose;
}): Promise<VerifyResult> {
  const email = params.email.trim().toLowerCase();
  const code = params.code.trim();
  if (!/^\d{6}$/.test(code)) throw new AuthError("INVALID_CODE", "请输入 6 位数字验证码", 422);

  const user = await q1<{
    id: string;
    org_id: string;
    email: string;
    name: string;
    role: string;
    avatar_hue: number;
    email_verified_at: string | null;
  }>(
    `select id, org_id, email, name, role, avatar_hue, email_verified_at
     from users where lower(email) = $1 limit 1`,
    [email],
  );
  if (!user) throw new AuthError("CODE_NOT_FOUND", "验证码不正确或已失效，请重新获取", 400);

  if (user.email_verified_at) {
    throw new AuthError("ALREADY_VERIFIED", "该邮箱已验证，请直接登录", 409);
  }

  const row = await q1<{
    id: string;
    code_hash: string;
    attempts: number;
    expires_at: string;
  }>(
    `select id, code_hash, attempts, expires_at from email_verifications
     where user_id = $1 and purpose = $2 and consumed_at is null
     order by created_at desc limit 1`,
    [user.id, params.purpose ?? "register"],
  );
  if (!row) throw new AuthError("CODE_NOT_FOUND", "验证码不正确或已失效，请重新获取", 400);

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await q(`update email_verifications set consumed_at = now() where id = $1`, [row.id]);
    throw new AuthError("CODE_EXPIRED", "验证码已过期，请重新获取", 410);
  }

  if (Number(row.attempts) >= env.verify.maxAttempts) {
    await q(`update email_verifications set consumed_at = now() where id = $1`, [row.id]);
    throw new AuthError("TOO_MANY_ATTEMPTS", "尝试次数过多，请重新获取验证码", 429);
  }

  if (!safeEqual(row.code_hash, hashCode(user.id, code))) {
    const attempts = Number(row.attempts) + 1;
    await q(`update email_verifications set attempts = $2 where id = $1`, [row.id, attempts]);
    const left = Math.max(0, env.verify.maxAttempts - attempts);
    throw new AuthError(
      "INVALID_CODE",
      left > 0 ? `验证码不正确，还可尝试 ${left} 次` : "尝试次数过多，请重新获取验证码",
      400,
    );
  }

  await q(`update email_verifications set consumed_at = now() where id = $1`, [row.id]);
  await q(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [
    user.id,
  ]);

  const sessionUser: SessionUser = {
    id: user.id,
    orgId: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarHue: Number(user.avatar_hue ?? 38),
    isAdmin: false,
  };
  await q(`update users set last_login_at = now() where id = $1`, [user.id]);
  await createSession({
    userId: user.id,
    orgId: user.org_id,
    ip: params.ip,
    userAgent: params.userAgent,
  });
  return { user: sessionUser };
}

/** 给未验证账号重发验证码（登录页拦截后调用）。不区分"邮箱不存在"，避免账号枚举。 */
export async function resendVerification(params: {
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ sent: boolean; expiresAt?: string; devCode: string | null; driver: string }> {
  const email = params.email.trim().toLowerCase();
  const user = await q1<{ id: string; email_verified_at: string | null }>(
    `select id, email_verified_at from users where lower(email) = $1 limit 1`,
    [email],
  );
  if (!user || user.email_verified_at) {
    // 已注册已验证 / 根本不存在 —— 对外都是"如果该邮箱待验证，邮件已发出"
    return { sent: false, devCode: null, driver: env.mail.driver };
  }
  const issued = await issueVerification({
    userId: user.id,
    email,
    ip: params.ip,
    userAgent: params.userAgent,
  });
  return {
    sent: true,
    expiresAt: issued.expiresAt,
    devCode: issued.devCode,
    driver: issued.driver,
  };
}
