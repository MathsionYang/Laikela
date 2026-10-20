/**
 * 账号与会话。
 *
 *  - 口令：scrypt + 随机盐，库里只存摘要（scrypt$<salt>$<hash>）
 *  - 会话：cookie 里放 32 字节随机 token；库里只存 sha256(token)
 *    ——即使数据库被拖走，攻击者也无法反推出可用的 cookie
 *  - 所有 API 通过 getSession() 拿 orgId，天然按租户隔离
 */
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { newId, q, q1 } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export { hashPassword, verifyPassword };

export const SESSION_COOKIE = "lk_session";
const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  avatarHue: number;
}

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------ 口令（见 lib/password.ts） ------------------------------ */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/* ------------------------------ 会话 ------------------------------ */

export async function createSession(params: {
  userId: string;
  orgId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await q(
    `insert into sessions (id, user_id, org_id, token_hash, user_agent, ip, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [newId("ses"), params.userId, params.orgId, sha256(token), params.userAgent ?? null, params.ip ?? null, expires],
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    /**
     * 是否只在 HTTPS 下发送。
     * 默认跟随协议判断过于隐晦，这里用显式开关：
     *  - 生产（有 TLS）请设置 COOKIE_SECURE=1
     *  - 本机 `next start` 走 http，若强制 secure，浏览器/客户端都不会回传 cookie，登录会「假成功」
     */
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
  });
  return token;
}

/** 每个请求只查一次库（React cache 在 RSC 渲染期去重） */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await q1<{
    id: string;
    org_id: string;
    email: string;
    name: string;
    role: string;
    avatar_hue: number;
  }>(
    `select u.id, u.org_id, u.email, u.name, u.role, u.avatar_hue
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
     limit 1`,
    [sha256(token)],
  );
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarHue: Number(row.avatar_hue ?? 38),
  };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await q(`update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, [
      sha256(token),
    ]);
  }
  jar.delete(SESSION_COOKIE);
}

/* ------------------------------ 登录 ------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function login(params: {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<SessionUser> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AuthError("INVALID_EMAIL", "邮箱格式不正确", 422);

  const row = await q1<{
    id: string;
    org_id: string;
    email: string;
    name: string;
    role: string;
    avatar_hue: number;
    password_hash: string | null;
  }>(
    `select id, org_id, email, name, role, avatar_hue, password_hash
     from users where lower(email) = $1 limit 1`,
    [email],
  );

  // 统一错误文案，避免账号枚举
  if (!row || !verifyPassword(params.password, row.password_hash)) {
    throw new AuthError("BAD_CREDENTIALS", "邮箱或密码不正确", 401);
  }

  await q(`update users set last_login_at = now() where id = $1`, [row.id]);
  await createSession({
    userId: row.id,
    orgId: row.org_id,
    userAgent: params.userAgent,
    ip: params.ip,
  });

  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarHue: Number(row.avatar_hue ?? 38),
  };
}

/* ------------------------------ 注册 ------------------------------ */

export async function register(params: {
  email: string;
  password: string;
  name: string;
  orgName?: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<SessionUser> {
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  if (!EMAIL_RE.test(email)) throw new AuthError("INVALID_EMAIL", "邮箱格式不正确", 422);
  if (params.password.length < 8) throw new AuthError("WEAK_PASSWORD", "密码至少 8 位", 422);
  if (!name) throw new AuthError("INVALID_NAME", "请填写称呼", 422);

  const exists = await q1<{ id: string }>(`select id from users where lower(email) = $1`, [email]);
  if (exists) throw new AuthError("EMAIL_TAKEN", "该邮箱已注册，请直接登录", 409);

  const orgId = newId("org");
  const userId = newId("usr");
  const orgName = params.orgName?.trim() || `${name}的空间`;

  await q(`insert into organizations (id, name, plan, quota_month) values ($1,$2,'free',200)`, [
    orgId,
    orgName,
  ]);
  await q(
    `insert into users (id, org_id, email, name, role, avatar_hue, password_hash)
     values ($1,$2,$3,$4,'owner',38,$5)`,
    [userId, orgId, email, name, hashPassword(params.password)],
  );

  // 新账号送免费版额度，进来就能跑通一条链路
  const { startSubscription } = await import("@/lib/billing");
  await startSubscription({ orgId, planCode: "free", months: 1, channel: "mock" });

  await createSession({ userId, orgId, userAgent: params.userAgent, ip: params.ip });

  return { id: userId, orgId, email, name, role: "owner", avatarHue: 38 };
}
