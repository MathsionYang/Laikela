/**
 * 凭证管理。
 *
 * 两类来源：
 *  1. 平台托管（platform）：写在本机 .env，所有租户共用，费用由平台承担
 *  2. 用户自带（byok）：用户在自己账号下填 Key，加密后存库，只对该租户生效
 *
 * 安全要点：
 *  - 明文永不落库、永不返回前端；库里只有 AES-256-GCM 密文
 *  - 主密钥来自 CREDENTIAL_SECRET（未配置时退化用 SIGNING_SECRET 派生）
 *  - 前端只能拿到掩码 hint（前 4 + 后 4），用于确认"我填的是哪一把"
 *  - 篡改密文会在解密时 GCM tag 校验失败，直接报错而不是静默降级
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { newId, q, q1 } from "@/lib/db";

export type ProviderId = "deepseek" | "doubao";

export interface CredentialRow {
  id: string;
  org_id: string;
  provider: string;
  label: string;
  key_hint: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

export interface CredentialView {
  provider: ProviderId;
  configured: boolean;
  label: string | null;
  keyHint: string | null;
  status: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

const PROVIDERS: ProviderId[] = ["deepseek", "doubao"];

/* ------------------------------- 加解密 ------------------------------- */

let cachedKey: Buffer | undefined;

function masterKey(): Buffer {
  if (!cachedKey) {
    const secret = env.credentialSecret || env.signingSecret;
    // 固定盐 + 域分离标签，保证同一个 secret 派生出专用的加密密钥
    cachedKey = createHash("sha256").update(`laikela:credentials:${secret}`).digest();
  }
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, data] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("凭证格式不正确");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  return out.toString("utf8");
}

const hintOf = (key: string) =>
  key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;

/* ------------------------------- 平台密钥 ------------------------------- */

/** 平台托管的 Key（来自 .env）。没有就返回空串，路由会自动跳过该模型。 */
export function platformKey(provider: ProviderId): string {
  if (provider === "deepseek") return env.providers.deepseek.apiKey;
  if (provider === "doubao") return env.providers.doubao.apiKey;
  return "";
}

export function baseUrlOf(provider: ProviderId): string {
  return provider === "deepseek"
    ? env.providers.deepseek.baseUrl
    : env.providers.doubao.baseUrl;
}

/* ------------------------------- BYOK ------------------------------- */

export async function saveCredential(params: {
  orgId: string;
  provider: ProviderId;
  apiKey: string;
  label?: string;
  createdBy?: string;
}): Promise<CredentialView> {
  const apiKey = params.apiKey.trim();
  if (apiKey.length < 12) throw new Error("Key 长度不合理，请检查是否粘贴完整");
  const cipher = encryptSecret(apiKey);
  const hint = hintOf(apiKey);

  await q(
    `insert into provider_credentials (id, org_id, provider, label, secret_cipher, key_hint, status, created_by)
     values ($1,$2,$3,$4,$5,$6,'active',$7)
     on conflict (org_id, provider) do update set
       label = excluded.label,
       secret_cipher = excluded.secret_cipher,
       key_hint = excluded.key_hint,
       status = 'active',
       last_error = null,
       updated_at = now()`,
    [
      newId("cred"),
      params.orgId,
      params.provider,
      params.label ?? `${params.provider} Key`,
      cipher,
      hint,
      params.createdBy ?? "owner",
    ],
  );

  const all = await listCredentials(params.orgId);
  return all.find((c) => c.provider === params.provider)!;
}

export async function listCredentials(orgId: string): Promise<CredentialView[]> {
  const rows = await q<CredentialRow>(
    `select id, org_id, provider, label, key_hint, status, created_at, last_used_at, last_error
     from provider_credentials where org_id = $1`,
    [orgId],
  );
  const map = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((provider) => {
    const r = map.get(provider);
    return {
      provider,
      configured: Boolean(r),
      label: r?.label ?? null,
      keyHint: r?.key_hint ?? null,
      status: r?.status ?? null,
      lastUsedAt: r?.last_used_at ?? null,
      lastError: r?.last_error ?? null,
    };
  });
}

export async function deleteCredential(orgId: string, provider: ProviderId): Promise<void> {
  await q(`delete from provider_credentials where org_id = $1 and provider = $2`, [orgId, provider]);
}

/**
 * 取某租户在某供应商上实际可用的 Key。
 * 优先级：BYOK（用户自己的）> 平台托管。
 * 返回 source 是为了计费与审计区分「谁在付费」。
 */
export async function resolveKey(
  orgId: string,
  provider: ProviderId,
): Promise<{ apiKey: string; source: "byok" | "platform" | "none" }> {
  const row = await q1<{ secret_cipher: string; status: string }>(
    // status='error' 只是「上次调用失败」的标记，不阻断使用 ——
    // 一次限流或网络抖动不该让用户的 Key 永久失效。只有 disabled 才真的停用。
    `select secret_cipher, status from provider_credentials
     where org_id = $1 and provider = $2 and status <> 'disabled' limit 1`,
    [orgId, provider],
  );
  if (row?.secret_cipher) {
    try {
      return { apiKey: decryptSecret(row.secret_cipher), source: "byok" };
    } catch (err) {
      await markError(orgId, provider, `凭证解密失败：${(err as Error).message}`);
      // 解密失败不静默回落到平台 Key，避免用户以为在用自己的 Key 却被计费
      return { apiKey: "", source: "none" };
    }
  }
  const pk = platformKey(provider);
  return { apiKey: pk, source: pk ? "platform" : "none" };
}

export async function markUsed(orgId: string, provider: ProviderId): Promise<void> {
  // 调用成功顺带把上一次的错误标记清掉，避免界面一直挂着红字
  await q(
    `update provider_credentials
     set last_used_at = now(), last_error = null,
         status = case when status = 'error' then 'active' else status end
     where org_id = $1 and provider = $2`,
    [orgId, provider],
  );
}

export async function markError(
  orgId: string,
  provider: ProviderId,
  error: string,
): Promise<void> {
  await q(
    `update provider_credentials set last_error = $3, status = 'error' where org_id = $1 and provider = $2`,
    [orgId, provider, error.slice(0, 200)],
  );
}
