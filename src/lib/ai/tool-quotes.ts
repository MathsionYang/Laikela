/**
 * 工具报价 —— 卡片上写的「x 积分 / y 秒」，就是这一单真正会扣的积分与真正会跑的时间。
 *
 * 为什么要有这一层：
 *   以前 ToolDef 上写着 creditCost: 6，卡片照抄；而服务端按计费量 × 模型单价 算，
 *   用户配了豆包 Key 之后实际扣 10 —— 卡片和账单各说各话，等于虚假标价。
 *   现在卡片上的数由这里产出：先定「这一单会用哪个模型」（与服务端同一套路由），
 *   再按同一个 quoteCost 算积分；耗时取近 90 天同档引擎的实测中位数。
 *
 * 数据来源全部是运行时事实，没有第二套手写常量。
 */
import {
  listModelViews,
  quoteCost,
  resolveModel,
  type ModelView,
  type ResolvedModel,
} from "./router";
import { quoteCost as priceOf, unitsOf } from "@/lib/domain/pricing";
import { TOOLS, type ToolKind } from "@/lib/domain/tools";
import { pickEta, toolRunStats, type ToolRunStat } from "@/lib/jobs/stats";
import type { ModelKind } from "./catalog";

const MODEL_KIND: Record<ToolKind, ModelKind> = {
  copy: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

export interface ToolQuote {
  /** 默认输入下的实际扣分 */
  credits: number;
  /** 计费量（千 token / 张 / 秒 / 千字符） */
  units: number;
  /** 会自动选中的模型 */
  modelKey: string;
  modelLabel: string;
  /** 该模型的官方成本单价，前端换输入后要按它重算 */
  unitPrice: number;
  keySource: "platform" | "byok" | "local";
  /** 当前套餐下该工具的价格区间（最便宜 / 最贵的可用模型） */
  minCredits: number;
  maxCredits: number;
  /** 预计耗时（秒） */
  etaSeconds: number;
  etaSource: "measured" | "baseline";
  /** 实测样本数，0 表示还在用基线 */
  etaSamples: number;
}

export type ToolQuoteMap = Record<string, ToolQuote>;

const keySourceOf = (v: ModelView): "platform" | "byok" =>
  v.keySource === "byok" ? "byok" : "platform";

/** 一个工具在当前套餐下的报价 */
function quoteFor(
  tool: (typeof TOOLS)[number],
  resolved: ResolvedModel | undefined,
  views: ModelView[],
  planCode: string | null,
  stats: Map<string, ToolRunStat>,
): ToolQuote | null {
  if (!resolved) return null;

  const kind = MODEL_KIND[tool.kind];
  const spec = resolved.spec;
  const price = spec.unitPrice ?? 0;
  const keySource: ToolQuote["keySource"] =
    spec.provider === "local" ? "local" : resolved.keySource;

  const units = unitsOf(tool);
  const credits = quoteCost(tool, resolved, planCode);

  // 可替换模型的价格区间：让用户知道「换模型会贵/便宜多少」。
  // 排除 byokOnly（只能手动选、平台不代付），否则区间会被 Seedance 这类按秒计费拉成天文数字。
  const usable = views.filter((v) => v.kind === kind && v.usable && !v.byokOnly);
  const prices = usable.map((v) => priceOf(tool, v.unitPrice ?? 0, keySourceOf(v), planCode));
  const minCredits = prices.length ? Math.min(...prices) : credits;
  const maxCredits = prices.length ? Math.max(...prices) : credits;

  const eta = pickEta(stats.get(tool.slug), spec.provider === "local", tool.etaBaseline);

  return {
    credits,
    units,
    modelKey: spec.key,
    modelLabel: spec.label,
    unitPrice: price,
    keySource,
    minCredits,
    maxCredits,
    etaSeconds: eta.seconds,
    etaSource: eta.source,
    etaSamples: eta.samples,
  };
}

/**
 * 一次算出全部工具的报价。
 * 目录视图与实测统计各查一次，模型按 kind 只解析一次（text/image/video/audio 各一）。
 */
export async function toolQuotes(
  orgId: string,
  planCode: string | null,
): Promise<ToolQuoteMap> {
  const [views, stats] = await Promise.all([listModelViews(orgId, planCode), toolRunStats()]);

  const resolvedByKind = new Map<ModelKind, ResolvedModel>();
  for (const kind of ["text", "image", "video", "audio"] as ModelKind[]) {
    try {
      resolvedByKind.set(
        kind,
        await resolveModel({
          orgId,
          kind,
          planCode,
          views,
          // 文案类工具都带 copy 能力，报价要和真实下单挑到同一个模型
          capability: kind === "text" ? "copy" : undefined,
        }),
      );
    } catch {
      // 该类型没有任何可用模型（理论上本地引擎兜底，不会发生）—— 交给前端走 baseCredits
    }
  }

  const out: ToolQuoteMap = {};
  for (const tool of TOOLS) {
    const q = quoteFor(tool, resolvedByKind.get(MODEL_KIND[tool.kind]), views, planCode, stats);
    if (q) out[tool.slug] = q;
  }
  return out;
}
