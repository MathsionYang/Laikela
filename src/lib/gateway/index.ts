import { env } from "@/lib/env";
import { PROMPTS } from "@/lib/domain/prompts";
import { coerceBlocks, blocksToPlain, type Block } from "@/lib/domain/blocks";
import type { ToolDef } from "@/lib/domain/tools";
import { localProvider } from "./local";
import { openAiCompat } from "./openai-compat";
import { ProviderError, type ProviderAdapter, type UsageCost } from "./types";
import { resolveModel, toTextAdapter, type ResolvedModel } from "@/lib/ai/router";

const deepseek = openAiCompat({
  id: "deepseek",
  label: "DeepSeek",
  apiKey: env.providers.deepseek.apiKey,
  baseUrl: env.providers.deepseek.baseUrl,
  model: env.providers.deepseek.model,
  priceIn: 1.0,
  priceOut: 2.0,
});

const doubao = openAiCompat({
  id: "doubao",
  label: "豆包大模型",
  apiKey: env.providers.doubao.apiKey,
  baseUrl: env.providers.doubao.baseUrl,
  model: env.providers.doubao.model,
  priceIn: 0.8,
  priceOut: 2.0,
});

/**
 * 平台侧 Provider 清单，仅供健康检查展示「平台 Key 有没有配上」。
 * 真正的模型选择走 lib/ai/router（它还会看租户 BYOK 与套餐）。
 */
export const PROVIDERS: ProviderAdapter[] = [deepseek, doubao, localProvider];

export function providerById(id: string): ProviderAdapter | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** 兜底：显式指定 → 任意可用云端 → 本地规则引擎 */
export function policyFor(preferred?: string): ProviderAdapter {
  if (preferred) {
    const p = providerById(preferred);
    if (p?.available) return p;
  }
  return PROVIDERS.find((p) => p.available && p.id !== "local") ?? localProvider;
}

export interface CopyResult {
  blocks: Block[];
  plain: string;
  provider: string;
  model: string;
  /** 目录里的模型 key（deepseek-chat / doubao-pro-32k / local-text …） */
  modelKey: string;
  /** 目录里的展示名（DeepSeek V4.1 Flash），和图片/音频分支的 output.model.label 对齐 */
  modelLabel: string;
  /** 真正发给供应商的模型 id（deepseek-flash），排障时用于区分内部 key 与上游名字 */
  modelName: string;
  /** 这次是谁付的钱：platform（平台代付）| byok（用户自带 Key） */
  keySource: "byok" | "platform";
  usage: UsageCost;
  latencyMs: number;
  local: boolean;
  /** 供应商重试次数 */
  attempts: number;
  /** 首选模型失败后降级到本地的说明，成功直连时为 null */
  degraded: string | null;
}

const stripFence = (s: string) =>
  s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

function extractJson(raw: string): unknown {
  const text = stripFence(raw);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 把结构化输入拼成语义清晰的 user prompt（字段名用中文标签，模型更好理解） */
export function buildUserPrompt(tool: ToolDef, input: Record<string, unknown>): string {
  const lines = [`工具：${tool.name}`, `产出目标：${tool.outcome}`, "输入字段："];
  for (const f of tool.fields) {
    const v = input[f.id];
    if (v === undefined || v === null || v === "") continue;
    lines.push(`- ${f.label}：${String(v)}`);
  }
  lines.push("", "###INPUT###", JSON.stringify({ slug: tool.slug, input }));
  return lines.join("\n");
}

export interface GenerateOptions {
  /** 租户：决定 BYOK 能用谁的 Key，也是成本归属 */
  orgId: string;
  /** 当前套餐 code，决定能用哪些模型 */
  planCode: string;
  /** 用户显式选的模型 key；不传则自动路由 */
  modelKey?: string | null;
  signal?: AbortSignal;
  /** 模型确定后回调，任务层用它记录 model_provider / model_name */
  onProvider?: (p: ProviderAdapter, resolved: ResolvedModel | null) => void;
}

/**
 * 选模型。失败（库不可用、没权限、没 Key）不抛错，直接退化到本地引擎 ——
 * 文案生成是主路径，不能因为 Key 没配就整条链路跑不动。
 */
async function pickTextProvider(
  opts: GenerateOptions,
): Promise<{ adapter: ProviderAdapter; resolved: ResolvedModel | null; reason: string | null }> {
  try {
    const resolved = await resolveModel({
      orgId: opts.orgId,
      kind: "text",
      planCode: opts.planCode,
      preferredKey: opts.modelKey ?? undefined,
      capability: "copy",
    });
    if (resolved.spec.provider === "local") {
      return { adapter: localProvider, resolved, reason: null };
    }
    return { adapter: toTextAdapter(resolved, opts.orgId), resolved, reason: null };
  } catch (err) {
    return {
      adapter: localProvider,
      resolved: null,
      reason: `模型路由失败，已用本地引擎：${(err as Error).message}`,
    };
  }
}

/**
 * 文案生成：路由模型 → 调用 → JSON 宽松校验 → 失败重试一次。
 *
 * 远端模型最终失败（鉴权错、限流、网络）会降级到本地规则引擎，
 * 并在 degraded 字段写明原因 —— 任务仍然成功，但用户能看见发生了什么。
 */
export async function generateCopy(
  tool: ToolDef,
  input: Record<string, unknown>,
  opts: GenerateOptions,
): Promise<CopyResult> {
  const prompt = PROMPTS[tool.slug];
  if (!prompt) {
    throw new ProviderError("NO_PROMPT", `工具「${tool.name}」没有可用的提示词版本`, false);
  }

  const picked = await pickTextProvider(opts);
  opts.onProvider?.(picked.adapter, picked.resolved);

  const run = async (
    adapter: ProviderAdapter,
    resolved: ResolvedModel | null,
    reason: string | null,
  ): Promise<CopyResult> => {
    const baseUser = buildUserPrompt(tool, input);
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await adapter.generateText({
          system: prompt,
          user:
            attempt === 1
              ? baseUser
              : `${baseUser}\n\n注意：上一次输出不是合法 JSON，请严格只返回 JSON 对象。`,
          json: adapter.id !== "local",
          temperature: attempt === 1 ? 0.7 : 0.2,
          signal: opts.signal,
        });

        const parsed = extractJson(res.text);
        const blocks = coerceBlocks(parsed);
        if (!blocks) {
          lastErr = new ProviderError(
            "BAD_JSON",
            `${adapter.label} 返回内容不是预期的 JSON 结构`,
            true,
          );
          continue;
        }
        return {
          blocks,
          plain: blocksToPlain(blocks),
          provider: res.provider,
          model: res.model,
          modelKey: resolved?.spec.key ?? adapter.id,
          modelLabel: resolved?.spec.label ?? adapter.label,
          modelName: res.model,
          keySource: resolved?.keySource ?? "platform",
          usage: res.usage,
          latencyMs: res.latencyMs,
          local: res.local,
          attempts: attempt,
          degraded: reason,
        };
      } catch (err) {
        lastErr = err;
        if (err instanceof ProviderError && !err.retryable) break;
      }
    }

    if (lastErr instanceof ProviderError) throw lastErr;
    throw new ProviderError("UNKNOWN", `生成失败：${(lastErr as Error)?.message ?? "未知错误"}`);
  };

  try {
    return await run(picked.adapter, picked.resolved, picked.reason);
  } catch (err) {
    // 远端彻底失败 → 本地兜底，任务不失败，但必须把「为什么没用上真模型」说清楚：
    // 只写一句「调用失败」等于让用户自己猜是 Key、模型名还是网络的问题。
    if (picked.adapter.id === "local") throw err;
    const code = err instanceof ProviderError ? err.code : "UNKNOWN";
    const detail = (err as Error)?.message || String(err);
    const why =
      `${detail}（${code}）` +
      `本次已回落到本地规则引擎生成，积分按本地模型重新结算；` +
      `修好上面这条错误后重试即可走真实模型。`;
    return run(localProvider, null, why);
  }
}
