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
 */

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

export type KeySource = "byok" | "platform" | "none";

export interface QuoteInput {
  /** 工具计费量（千 token / 张 / 秒 / 千字符） */
  costUnits?: number;
  /** 工具标准扣分，仅作末位兜底 */
  creditCost?: number;
}

/**
 * 本次任务扣多少积分。
 *
 * @param unitPrice 所选模型的**官方成本单价**（元/单位）
 * @param keySource platform = 平台代付，byok = 用户自带 Key
 */
export function quoteCost(
  tool: QuoteInput,
  unitPrice: number,
  keySource: KeySource,
  planCode?: string | null,
): number {
  const rate = SERVICE_RATE[planCode ?? "free"] ?? SERVICE_RATE.free;
  const units = tool.costUnits ?? 1;
  const costFen = units * unitPrice * 100;

  // 自带 Key：模型费由用户直接付给供应商，平台只收编排服务费
  if (keySource === "byok") {
    return Math.max(1, Math.ceil(costFen * rate));
  }
  // 平台代付：成本 + 服务费
  return Math.max(1, Math.ceil(costFen * (1 + rate)));
}

/** 把积分换算成人民币，用于「本次约 ¥0.03」这类提示 */
export function creditsToCny(credits: number): number {
  return credits / 100;
}
