/**
 * 模型路由（Model Router）。
 *
 * 一次调用要回答三个问题：
 *   1. 谁能用？   —— 套餐权限（requiresPlan）+ 是否配置了 Key
 *   2. 用哪个？   —— 用户偏好 → 目录顺序（能力/成本）→ 降级链 → 本地兜底
 *   3. 谁付费？   —— platform（平台代付）还是 byok（用户自己的 Key）
 *
 * 路由结果不缓存「Key」，只缓存目录视图（短 TTL），因为 Key 可能随时被改。
 */
import { q, q1 } from "@/lib/db";
import { ProviderError, type ProviderAdapter, type TextRequest, type TextResult } from "@/lib/gateway/types";
import {
  MODEL_CATALOG,
  modelByKey,
  modelsOfKind,
  planAllows,
  type ModelKind,
  type ModelSpec,
} from "./catalog";
import { baseUrlOf, markError, markUsed, resolveKey, type ProviderId } from "./credentials";
import { chatCompletion } from "./adapters";
import { quoteCost as priceOf, SERVICE_RATE } from "@/lib/domain/pricing";
import type { BillingRule, ToolKind } from "@/lib/domain/tools";
import {
  customSpecs,
  endpointIdOf,
  isCustomKey,
  markEndpointError,
  markEndpointUsed,
  resolveEndpoint,
} from "./custom";

export interface ModelView extends ModelSpec {
  enabled: boolean;
  available: boolean;
  keySource: "byok" | "platform" | "none";
  allowedByPlan: boolean;
  usable: boolean;
  /** 目录排序权重，越小越优先（运维可在库里调整） */
  priority: number;
  /** 不可用原因，直接展示给用户 */
  reason?: string;
}

export interface ResolvedModel {
  spec: ModelSpec;
  apiKey: string;
  baseUrl: string;
  keySource: "byok" | "platform";
  /** 平台代付扣的积分；BYOK 时为 0 */
  credits: number;
}

async function metaMap(): Promise<Map<string, { enabled: boolean; priority: number; credits: number | null }>> {
  const rows = await q<{ key: string; enabled: boolean; priority: number; credits: number | null }>(
    `select key, enabled, priority, credits from model_catalog`,
  );
  return new Map(rows.map((r) => [r.key, { enabled: r.enabled, priority: r.priority, credits: r.credits }]));
}

export async function listModelViews(
  orgId: string,
  planCode: string | null,
): Promise<ModelView[]> {
  const meta = await metaMap();
  const providerKeys = new Map<ProviderId, { apiKey: string; source: "byok" | "platform" | "none" }>();
  for (const p of ["deepseek", "doubao"] as ProviderId[]) {
    providerKeys.set(p, await resolveKey(orgId, p));
  }

  const builtIn = MODEL_CATALOG.map((spec, index) => {
    const m = meta.get(spec.key);
    const isLocal = spec.provider === "local";
    const cred = isLocal
      ? { apiKey: "local", source: "platform" as const }
      : (providerKeys.get(spec.provider as ProviderId) ??
        { apiKey: "", source: "none" as const });
    const available = Boolean(cred.apiKey);
    const allowedByPlan = planAllows(spec, planCode);
    const byokReady = cred.source === "byok";

    // byokOnly 的模型：平台不代付，必须自己带 Key
    const planOk = spec.byokOnly ? byokReady : allowedByPlan || byokReady;
    const on = m?.enabled !== false;
    const usable = on && available && planOk;

    let reason: string | undefined;
    if (!on) reason = "已被管理员关闭";
    else if (!available) reason = "未配置 API Key";
    else if (!planOk) reason = `需要「${spec.requiresPlan}」及以上套餐，或自带 Key`;

    return {
      ...spec,
      // 运维可在库里覆盖单价与积分，代码里的值是默认值
      credits: m?.credits ?? spec.credits,
      enabled: on,
      available,
      keySource: cred.source,
      allowedByPlan: planOk,
      usable,
      priority: m?.priority ?? index,
      reason,
    };
  });

  // 自定义端点：URL/模型名/Key 都是用户自己的，等价于 BYOK
  const custom = await customSpecs(orgId);
  const customViews: ModelView[] = custom.map((spec, i) => ({
    ...spec,
    enabled: spec.enabled,
    available: true,
    keySource: "byok" as const,
    allowedByPlan: true,
    usable: spec.enabled,
    priority: 100 + i,
    reason: spec.enabled ? undefined : "已被管理员停用",
  }));

  return [...builtIn, ...customViews];
}

/** 平台代付时该模型扣多少积分（BYOK 不扣） */
export function creditsFor(spec: ModelSpec, keySource: "byok" | "platform"): number {
  return keySource === "byok" ? 0 : spec.credits;
}

/**
 * 本次任务实际扣多少积分。计价口径统一在 `lib/domain/pricing.ts`，
 * 前端预览与服务端扣费共用同一份实现，避免两边算出不同的数。
 *
 * 传 input 后按实际张数 / 秒数 / 字数计费；不传则按默认输入（卡片展示用）。
 */
export function quoteCost(
  tool: { kind: ToolKind; billing: BillingRule },
  r: ResolvedModel,
  planCode?: string | null,
  input?: Record<string, unknown> | null,
): number {
  return priceOf(tool, r.spec.unitPrice ?? 0, r.keySource, planCode, input);
}

/**
 * 选模型。顺序：显式偏好 → 目录优先级 → 降级链 → 本地兜底。
 * 返回值一定非空（最差也是 local-*）。
 */
export async function resolveModel(params: {
  orgId: string;
  kind: ModelKind;
  planCode: string | null;
  preferredKey?: string | null;
  capability?: string;
  /** 已经查过目录视图时传进来，避免一个请求里重复打库（工具报价会按 kind 各调一次） */
  views?: ModelView[];
}): Promise<ResolvedModel> {
  const views = params.views ?? (await listModelViews(params.orgId, params.planCode));
  const usable = views.filter((v) => v.kind === params.kind && v.usable);

  const build = async (v: ModelView): Promise<ResolvedModel | null> => {
    if (v.provider === "custom") {
      const id = v.endpointId ?? endpointIdOf(v.key);
      const ep = await resolveEndpoint(params.orgId, id);
      if (!ep) return null;
      return {
        spec: v,
        apiKey: ep.apiKey,
        baseUrl: ep.baseUrl,
        keySource: "byok",
        credits: 0,
      };
    }
    if (v.provider === "local") {
      return {
        spec: v,
        apiKey: "local",
        baseUrl: "local://",
        keySource: "platform",
        credits: 0,
      };
    }
    const { apiKey, source } = await resolveKey(params.orgId, v.provider as ProviderId);
    if (!apiKey || source === "none") return null;
    return {
      spec: v,
      apiKey,
      baseUrl: baseUrlOf(v.provider as ProviderId),
      keySource: source,
      credits: creditsFor(v, source),
    };
  };

  // 1) 用户显式偏好
  if (params.preferredKey) {
    const pref = usable.find((v) => v.key === params.preferredKey);
    if (pref) {
      const r = await build(pref);
      if (r) return r;
    }
  }

  // 2) 能力匹配优先，再按目录优先级（成本/质量已人工排序）
  //
  // byokOnly 的模型（Seedance 这类按秒计费、一条几十块的）**不参与自动路由**：
  // 它存在的意义就是「平台不代付，避免误点烧钱」，自动选中它等于把这个保险拆了。
  // 用户明确选它（preferredKey）时才走上面第 1 步。
  const autoPool = usable.filter((v) => !v.byokOnly);
  const ranked = [...(autoPool.length > 0 ? autoPool : usable)].sort((a, b) => {
    const capA = params.capability && a.capabilities.includes(params.capability) ? 0 : 1;
    const capB = params.capability && b.capabilities.includes(params.capability) ? 0 : 1;
    if (capA !== capB) return capA - capB;
    const localA = a.provider === "local" ? 1 : 0;
    const localB = b.provider === "local" ? 1 : 0;
    if (localA !== localB) return localA - localB; // 本地永远最后
    return a.priority - b.priority;
  });

  for (const v of ranked) {
    const r = await build(v);
    if (r) return r;
    // 降级链：当前不可用时尝试 fallback
    if (v.fallback) {
      const fb = views.find((x) => x.key === v.fallback && x.usable);
      if (fb) {
        const fr = await build(fb);
        if (fr) return fr;
      }
    }
  }

  // 3) 兜底：本地引擎（任何租户都可用）
  const local = views.find((v) => v.kind === params.kind && v.provider === "local");
  if (local) {
    return { spec: local, apiKey: "local", baseUrl: "local://", keySource: "platform", credits: 0 };
  }
  throw new ProviderError("NO_MODEL", `没有可用的 ${params.kind} 模型`, false);
}

/**
 * 把路由结果包装成统一的 ProviderAdapter，
 * 这样现有 generateCopy 不用感知「多供应商 / BYOK」这些细节。
 * orgId 显式传入：BYOK 场景要按租户记录 last_used_at / last_error。
 */
export function toTextAdapter(r: ResolvedModel, orgId: string): ProviderAdapter {
  const spec = r.spec;
  const isRemote = spec.provider !== "local";
  return {
    id: spec.key,
    label: `${spec.vendor} · ${spec.label}`,
    available: true,
    async generateText(req: TextRequest): Promise<TextResult> {
      const customId = spec.provider === "custom" ? (spec.endpointId ?? endpointIdOf(spec.key)) : null;
      try {
        const res = await chatCompletion({
          baseUrl: r.baseUrl,
          apiKey: r.apiKey,
          model: spec.modelName,
          label: `${spec.vendor} · ${spec.label}`,
          priceIn: spec.unitPrice,
          priceOut: spec.unitPrice * 2,
          system: req.system,
          user: req.user,
          json: req.json,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          signal: req.signal,
        });
        if (customId) {
          await markEndpointUsed(orgId, customId).catch(() => {});
        } else if (r.keySource === "byok" && isRemote) {
          await markUsed(orgId, spec.provider as ProviderId).catch(() => {});
        }
        return res;
      } catch (err) {
        if (err instanceof ProviderError) {
          if (customId) {
            await markEndpointError(orgId, customId, err.message).catch(() => {});
          } else if (r.keySource === "byok" && isRemote) {
            await markError(orgId, spec.provider as ProviderId, err.message).catch(() => {});
          }
        }
        throw err;
      }
    },
  };
}

/** 目录里是否存在某供应商的模型（用于判断 BYOK 是否有意义） */
export const providerModels = (provider: ProviderId) =>
  MODEL_CATALOG.filter((m) => m.provider === provider);

/** 该 key 是否是用户自定义端点 */
export const isCustomModel = isCustomKey;

export { modelByKey, modelsOfKind };
