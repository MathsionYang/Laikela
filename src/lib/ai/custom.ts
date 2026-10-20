/**
 * 自定义端点（Custom Endpoint）。
 *
 * 场景：用户手上有一个「OpenAI 协议兼容」的服务 —— 自建 vLLM / Ollama 网关、
 * 中转站、Azure OpenAI、硅基流动、月之暗面、通义、以及各种第三方兼容层。
 * 它们共同的形态是：
 *
 *   POST {baseUrl}/chat/completions   { model, messages }
 *   Authorization: Bearer {apiKey}
 *
 * 所以不需要为每家写适配器：只要 URL、模型名、Key 三个值，就能接进来。
 *
 * 与 provider_credentials（BYOK）的分工：
 *  - provider_credentials：同一家厂商「换一把自己的钥匙」，base_url 与模型名由平台决定
 *  - model_endpoints：一个全新的服务，base_url 与模型名都由用户填
 */
import { newId, q, q1 } from "@/lib/db";
import type { ModelKind, ModelSpec } from "./catalog";
import { decryptSecret, encryptSecret } from "./credentials";

export type EndpointKind = "text" | "image";

export interface EndpointRow {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  protocol: string;
  base_url: string;
  model_name: string;
  context_k: number | null;
  credits: number;
  secret_cipher: string;
  key_hint: string;
  enabled: boolean;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface EndpointView {
  id: string;
  name: string;
  kind: EndpointKind;
  protocol: string;
  baseUrl: string;
  modelName: string;
  contextK: number | null;
  credits: number;
  keyHint: string;
  enabled: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  /** 目录里引用它的 key：custom:<id> */
  modelKey: string;
}

/** 自定义端点在模型目录里的 key 前缀 */
export const CUSTOM_PREFIX = "custom:";
export const customModelKey = (id: string) => `${CUSTOM_PREFIX}${id}`;
export const isCustomKey = (key: string) => key.startsWith(CUSTOM_PREFIX);
export const endpointIdOf = (key: string) => key.slice(CUSTOM_PREFIX.length);

const toView = (r: EndpointRow): EndpointView => ({
  id: r.id,
  name: r.name,
  kind: r.kind === "image" ? "image" : "text",
  protocol: r.protocol,
  baseUrl: r.base_url,
  modelName: r.model_name,
  contextK: r.context_k,
  credits: r.credits,
  keyHint: r.key_hint,
  enabled: r.enabled,
  lastUsedAt: r.last_used_at,
  lastError: r.last_error,
  modelKey: customModelKey(r.id),
});

const hintOf = (key: string) =>
  key.length <= 8 ? "••••" : `${key.slice(0, 3)}••••${key.slice(-4)}`;

/**
 * 规范化 baseUrl：
 *  - 去掉尾部斜杠
 *  - 去掉用户误粘贴的 /chat/completions 结尾
 *  - 没写协议时补 https://
 * 不自动补 /v1 —— 有些网关就是根路径，猜错更难排查；由「测试连接」给真实反馈。
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions$/i, "");
  url = url.replace(/\/images\/generations$/i, "");
  return url;
}

export async function listEndpoints(orgId: string): Promise<EndpointView[]> {
  const rows = await q<EndpointRow>(
    `select * from model_endpoints where org_id = $1 order by created_at desc`,
    [orgId],
  );
  return rows.map(toView);
}

export async function getEndpoint(orgId: string, id: string): Promise<EndpointRow | null> {
  return q1<EndpointRow>(`select * from model_endpoints where org_id = $1 and id = $2`, [orgId, id]);
}

export async function createEndpoint(params: {
  orgId: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  contextK?: number | null;
  credits?: number;
  createdBy?: string;
}): Promise<EndpointView> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("请填写 Base URL");
  if (!params.modelName.trim()) throw new Error("请填写模型名称");
  const apiKey = params.apiKey.trim();
  if (apiKey.length < 6) throw new Error("Key 长度不合理，请检查是否粘贴完整");
  if (!params.name.trim()) throw new Error("请给这个模型起个名字");

  const row = await q1<EndpointRow>(
    `insert into model_endpoints
       (id, org_id, name, kind, protocol, base_url, model_name, context_k, credits, secret_cipher, key_hint, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [
      newId("ep"),
      params.orgId,
      params.name.trim().slice(0, 40),
      params.kind,
      params.kind === "image" ? "ark-image" : "openai-chat",
      baseUrl,
      params.modelName.trim(),
      params.contextK ?? null,
      Math.max(1, Math.min(200, params.credits ?? 1)),
      encryptSecret(apiKey),
      hintOf(apiKey),
      params.createdBy ?? "owner",
    ],
  );
  if (!row) throw new Error("保存失败");
  return toView(row);
}

export async function deleteEndpoint(orgId: string, id: string): Promise<void> {
  await q(`delete from model_endpoints where org_id = $1 and id = $2`, [orgId, id]);
}

export async function setEndpointEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await q(
    `update model_endpoints set enabled = $3, updated_at = now() where org_id = $1 and id = $2`,
    [orgId, id, enabled],
  );
}

export async function markEndpointUsed(orgId: string, id: string): Promise<void> {
  await q(
    `update model_endpoints set last_used_at = now(), last_error = null where org_id = $1 and id = $2`,
    [orgId, id],
  );
}

export async function markEndpointError(orgId: string, id: string, error: string): Promise<void> {
  await q(
    `update model_endpoints set last_error = $3 where org_id = $1 and id = $2`,
    [orgId, id, error.slice(0, 200)],
  );
}

/** 取真实凭证（仅服务端使用，永不返回前端） */
export async function resolveEndpoint(
  orgId: string,
  id: string,
): Promise<{ apiKey: string; baseUrl: string; row: EndpointRow } | null> {
  const row = await getEndpoint(orgId, id);
  if (!row) return null;
  try {
    return { apiKey: decryptSecret(row.secret_cipher), baseUrl: row.base_url, row };
  } catch (err) {
    await markEndpointError(orgId, id, `凭证解密失败：${(err as Error).message}`);
    return null;
  }
}

/** 把端点记录映射成目录条目，让它和内置模型走同一套路由/计费/降级逻辑 */
export function endpointToSpec(view: EndpointView): ModelSpec {
  return {
    key: view.modelKey,
    provider: "custom",
    vendor: "自定义端点",
    label: view.name,
    kind: view.kind as ModelKind,
    protocol: view.kind === "image" ? "ark-image" : "openai-chat",
    path: view.kind === "image" ? "/images/generations" : "/chat/completions",
    modelName: view.modelName,
    contextK: view.contextK ?? undefined,
    unit: "k_token",
    unitPrice: 0,
    credits: view.credits,
    // 自带 URL + Key 的端点不受套餐限制
    requiresPlan: "free",
    capabilities: view.kind === "image" ? ["poster", "illustration"] : ["copy", "json", "custom"],
    endpointId: view.id,
    note: `${view.baseUrl} · ${view.modelName}（OpenAI 兼容协议）`,
  };
}

export async function customSpecs(orgId: string): Promise<Array<ModelSpec & { enabled: boolean }>> {
  const list = await listEndpoints(orgId);
  return list.map((v) => ({ ...endpointToSpec(v), enabled: v.enabled }));
}
