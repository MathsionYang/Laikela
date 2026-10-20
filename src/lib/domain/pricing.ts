/**
 * 计价口径 —— 服务端与前端共用同一份，避免「页面显示 3 积分、实际扣 5 积分」。
 *
 * 核心约定：**1 积分 = 1 分钱**。
 * 所有价格都能用采购成本反推，没有黑盒倍率，这是对「透明计费」的兑现。
 *
 * 成本来源（官方牌价，元/百万 token）：
 *   DeepSeek-V4-Flash  (1.00, 2.00)     → 加权 1.385 → 0.0014 元/K
 *   DeepSeek-V4-Pro    (3.00, 6.00)     → 加权 4.154 → 0.0042 元/K
 *   豆包 Seed-2.1-Pro  (6.00, 30.00)    → 加权 15.231 → 0.0152 元/K
 *   豆包 Seedream-5.0-Pro  0.30 元/张
 *   豆包 Seedance-2.5      70 元/M token ≈ 1.51 元/秒（720p，24fps）
 *   豆包 语音合成          5 元/万字符 → 0.05 元/千字
 *
 * 文本加权按「输入 : 输出 = 1.6 : 1」——这是内容生成任务的实测比例，
 * 推理类（选题拆解、竞品反推）输出占比更高，用成本更高的模型时会被费率自然放大。
 *
 * ⚠️ 计费量必须是**实际产出量**，不是拍脑袋的常数：
 *   · 出图按张数（1 / 2 / 3 / 4 / 9 张，云端是真按张收钱的）
 *   · 出片按秒数（15 / 30 / 60 秒，Seedance 按秒计费）
 *   · 配音按字符数（豆包 TTS 按万字符计费）
 *   · 文案按篇幅档位缩放
 * 曾经 video-movie 固定记 5 个计费秒、image-gen 固定记 1 张，
 * 而流水线实际产出 15–60 秒 / 最多 4 张 —— 结果是每单都在赔钱。
 * 现在由 ToolDef.billing 声明口径，unitsOf() 按输入换算，卡片与账单同一来源。
 */
import type { BillingRule, ToolKind } from "./tools";

/** 套餐服务费率：在采购成本上浮的幅度，按等级递减 */
export const SERVICE_RATE: Record<string, number> = {
  free: 0.05,
  creator: 0.045,
  studio: 0.04,
  enterprise: 0.03,
};

/** 服务费率区间，供 UI 文案与校验使用 */
export const SERVICE_RATE_MIN = 0.03;
export const SERVICE_RATE_MAX = 0.05;

/** 单任务最低计费，避免四舍五入把成本吞掉 */
export const MIN_CREDITS = 1;

/** 单任务计费量上限：防止有人粘 20 万字把单笔成本顶穿，也防止一次任务扣光整月额度 */
export const MAX_UNITS = 2000;

/** 本地引擎的影子单价，只在「没有任何模型可用」时用于兜底展示 */
export const BASELINE_UNIT_PRICE: Record<ToolKind, number> = {
  copy: 0.0001, // local-text
  image: 0.02, // local-render
  video: 0.01, // local-storyboard
  audio: 0.01, // local-tts
};

/**
 * 本地引擎耗时 / 云端基线 的比值（15 个工具的实测中位数）。
 * 放在这里是因为「卡片上的耗时」和「实测统计」都要用它，
 * 前后端各写一个 0.7 迟早在两个页面上打架。
 */
export const LOCAL_ETA_FACTOR = 0.7;

export type KeySource = "byok" | "platform" | "none";

/** 计价只需要「工具类型 + 计费规则」，不依赖整个 ToolDef */
export interface Priceable {
  kind: ToolKind;
  billing: BillingRule;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 本次任务要按多少「计费单位」结账。
 *
 * 单位随工具类型走：文案 = 千 token，出图 = 张，视频 = 秒，配音 = 千字符。
 * 不传 input 时按默认输入算（卡片展示与「最低价」都用这个口径）。
 */
export function unitsOf(tool: Priceable, input?: Record<string, unknown> | null): number {
  const rule = tool.billing;
  let units = rule.base;

  // 按字数换算（配音、口播）：取「字数折算」与基准值的较大者
  if (rule.perChars) {
    const chars = String(input?.[rule.perChars.field] ?? "").replace(/\s+/g, "").length;
    if (chars > 0) units = Math.max(units, chars / rule.perChars.charsPerUnit);
  }

  // 选项倍率（篇幅 / 张数 / 秒数 / 条数），乘算
  for (const s of rule.scale ?? []) {
    const factor = s.map[String(input?.[s.field] ?? "")];
    if (typeof factor === "number" && Number.isFinite(factor) && factor > 0) units *= factor;
  }

  return Math.min(MAX_UNITS, round3(Math.max(units, 0)));
}

/**
 * 本次任务扣多少积分。
 *
 * @param unitPrice 所选模型的**官方成本单价**（元/单位）
 * @param keySource platform = 平台代付，byok = 用户自带 Key
 * @param input     用户填写的输入；传入后会按实际张数 / 秒数 / 字数计费
 */
export function quoteCost(
  tool: Priceable,
  unitPrice: number,
  keySource: KeySource,
  planCode?: string | null,
  input?: Record<string, unknown> | null,
): number {
  const rate = SERVICE_RATE[planCode ?? "free"] ?? SERVICE_RATE.free;
  const costFen = unitsOf(tool, input) * unitPrice * 100;

  // 自带 Key：模型费由用户直接付给供应商，平台只收编排服务费
  if (keySource === "byok") return Math.max(MIN_CREDITS, Math.ceil(costFen * rate));
  // 平台代付：成本 + 服务费
  return Math.max(MIN_CREDITS, Math.ceil(costFen * (1 + rate)));
}

/** 计价拆解，用于「本次约 ¥0.03 · 按 4 张计费」这类提示 */
export interface QuoteBreakdown {
  units: number;
  /** 采购成本（分） */
  costFen: number;
  credits: number;
  /** 折算人民币（元） */
  cny: number;
  /** 相对成本的加价倍数，用于核对是否为正收益 */
  markup: number;
}

export function quoteBreakdown(
  tool: Priceable,
  unitPrice: number,
  keySource: KeySource,
  planCode?: string | null,
  input?: Record<string, unknown> | null,
): QuoteBreakdown {
  const units = unitsOf(tool, input);
  const costFen = round3(units * unitPrice * 100);
  const credits = quoteCost(tool, unitPrice, keySource, planCode, input);
  return {
    units,
    costFen,
    credits,
    cny: credits / 100,
    markup: costFen > 0 ? (credits * 1) / costFen : Number.POSITIVE_INFINITY,
  };
}

/**
 * 本地引擎跑一次要几个积分 —— 仅作为「拿不到服务端报价」时的兜底数字。
 * 与 quoteCost 同源，不存在第二套算法。
 */
export function baseCredits(tool: Priceable): number {
  return quoteCost(tool, BASELINE_UNIT_PRICE[tool.kind] ?? 0, "platform", "free");
}

/** 把积分换算成人民币，用于「本次约 ¥0.03」这类提示 */
export function creditsToCny(credits: number): number {
  return credits / 100;
}
