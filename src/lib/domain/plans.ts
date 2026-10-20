/**
 * 套餐目录 —— 纯数据，前后端与校验脚本共用。
 *
 * 额度不是拍脑袋定的，是从「正收益」反推出来的：
 *   额度上限 = (月费 × (1 - 目标净利率) - 固定成本) ÷ 最坏每积分成本
 * 推导过程见 docs/PRICING.md。scripts/check-margin 会按这张表跑压力测试。
 */
export interface PlanDef {
  code: string;
  name: string;
  tagline: string;
  /** 月费（元） */
  price: number;
  /** 每月发放积分 */
  credits: number;
  seats: number;
  sort: number;
  features: string[];
}

export const PLAN_CATALOG: PlanDef[] = [
  {
    code: "free",
    name: "体验版",
    tagline: "15 项能力全部开放，先把一条链路跑通",
    price: 0,
    credits: 200,
    seats: 1,
    sort: 0,
    features: [
      "15 项能力全部开放",
      "本地引擎 + 200 积分体验额度",
      "约 200 次文案 / 60 张海报",
      "素材保留 7 天",
      "单个任务最多 3 个变体",
    ],
  },
  {
    code: "creator",
    name: "创作版",
    tagline: "用多少扣多少，模型按官方成本价结算",
    price: 99,
    credits: 6000,
    seats: 1,
    sort: 1,
    features: [
      "6,000 积分（约 6,000 次文案 / 1,800 张图）",
      "云端模型：DeepSeek V4 / 豆包 Seed 2.1",
      "额度按固定成本反推，用满也不亏",
      "商用授权 · 素材保留 90 天",
      "批量变体与 A/B 文案",
    ],
  },
  {
    code: "studio",
    name: "工作室",
    tagline: "5 人共用一份额度，费率降到 4%",
    price: 299,
    credits: 22000,
    seats: 5,
    sort: 2,
    features: [
      "22,000 积分池 · 服务费 4%",
      "5 个席位，额度池共享",
      "品牌人设与口吻库 · 团队素材库",
      "OpenAPI 访问 · 优先队列（并发 4）",
      "用量分成员统计与预警",
    ],
  },
  {
    code: "enterprise",
    name: "企业版",
    tagline: "最低 3% 费率，席位与合规一起给",
    price: 1200,
    credits: 95000,
    seats: 30,
    sort: 3,
    features: [
      "95,000 积分池 · 服务费 3%（最低档）",
      "30 个席位 · 私有化部署可选",
      "专属模型通道与私有知识库",
      "SSO、权限分级、审计日志导出",
      "SLA 99.9% · 对公发票 · 专属对接人",
    ],
  },
];

export const planByCode = (code: string): PlanDef | undefined =>
  PLAN_CATALOG.find((p) => p.code === code);

/** 每 1 积分的实际售价（元），正收益校验的分母 */
export const creditValueOf = (code: string): number => {
  const p = planByCode(code);
  return p && p.credits > 0 ? p.price / p.credits : 0;
};
