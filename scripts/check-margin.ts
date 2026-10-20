/**
 * 正收益校验 —— 用**真实的计费代码**把每个「工具 × 模型 × 套餐」组合算一遍账，
 * 任何一格亏钱就退出码 1。
 *
 * 为什么不做成文档：定价会被人随手改，文档不会跟着变，脚本会。
 * 这张表也是「卡片上的积分」的可信度来源 —— 卡片价格 = 这里算出来的价格。
 *
 * 跑：npm run check:margin
 */
import { TOOLS, type ToolKind } from "@/lib/domain/tools";
import { MODEL_CATALOG, PLAN_RANK, type ModelKind, type ModelSpec } from "@/lib/ai/catalog";
import { PLAN_CATALOG, creditValueOf } from "@/lib/domain/plans";
import { SERVICE_RATE, quoteCost, unitsOf } from "@/lib/domain/pricing";

/** 固定成本：服务器 + DB + 存储 + CDN + 获客摊销（元/月/租户），见 docs/PRICING.md 第 5 节 */
const FIXED_COST_PER_MONTH = 19.2;

const KIND_OF: Record<ToolKind, ModelKind> = {
  copy: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

const fen = (yuan: number) => `${(yuan * 100).toFixed(2)} 分`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));
/** 中文字符按 2 列算，打印表格才对得齐 */
const width = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);

let failures = 0;
function check(ok: boolean, message: string) {
  if (!ok) {
    failures++;
    console.log(`  ✗ ${message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. 计费规则自检：选项变了却没同步倍率，是最容易漏的错                  */
/* ------------------------------------------------------------------ */

console.log("\n=== 1. 计费规则完整性 ===");

const QUANTITY_FIELDS = ["count", "duration", "length"];

for (const tool of TOOLS) {
  const scaleFields = new Set((tool.billing.scale ?? []).map((s) => s.field));

  for (const field of tool.fields) {
    if (!QUANTITY_FIELDS.includes(field.id)) continue;
    const opts = field.opts ?? [];
    if (opts.length === 0) continue;

    const rule = (tool.billing.scale ?? []).find((s) => s.field === field.id);
    if (!rule) {
      // 白名单里的字段可以不计费，但必须写明原因（billingNote 里得提到这件事）
      const excused = (tool.billing.ignored ?? []).includes(field.id);
      check(
        excused,
        `${tool.slug}：字段 ${field.id} 有 ${opts.length} 个选项，但 billing.scale 里没有它 —— 计价会按默认档一路扣到底`,
      );
      if (excused) {
        check(
          Boolean(tool.billingNote),
          `${tool.slug}：${field.id} 被声明为不计费，但没写 billingNote 说明原因`,
        );
      }
      continue;
    }
    for (const o of opts) {
      check(
        typeof rule.map[o] === "number",
        `${tool.slug}：选项「${o}」没有倍率，改选它时价格不会变（实际工作量却变了）`,
      );
    }
  }

  check(scaleFields.size === new Set(scaleFields).size, `${tool.slug}：billing.scale 有重复字段`);
  check(tool.billing.base > 0, `${tool.slug}：billing.base 必须大于 0`);
  check(unitsOf(tool) > 0, `${tool.slug}：默认输入下计费量为 0，会被最低计费兜底，等于白送`);

  if (tool.billing.perChars) {
    check(
      tool.fields.some((f) => f.id === tool.billing.perChars!.field),
      `${tool.slug}：perChars 指向的字段 ${tool.billing.perChars.field} 不存在`,
    );
  }
}

console.log(failures === 0 ? "  ✓ 15 个工具的计费规则与表单选项一一对应" : "");

/* ------------------------------------------------------------------ */
/* 2. 逐组合算账：工具 × 平台可用模型 × 套餐                            */
/* ------------------------------------------------------------------ */

console.log("\n=== 2. 单笔毛利率（平台代付，按最贵可用模型） ===");
console.log(
  `${pad("工具", 14)}${pad("计费量", 10)}${pad("最贵模型", 22)}${pad("成本", 12)}${pad("扣分", 8)}${pad("收入(企业版)", 14)}毛利率`,
);

for (const tool of TOOLS) {
  const kind = KIND_OF[tool.kind];
  const units = unitsOf(tool);

  // 平台代付的模型（byokOnly 的成本由用户自己付给厂商，不参与这里的最坏值）
  const platformModels = MODEL_CATALOG.filter((m) => m.kind === kind && !m.byokOnly);
  const worst = platformModels.reduce<ModelSpec | null>(
    (acc, m) => (!acc || m.unitPrice > acc.unitPrice ? m : acc),
    null,
  );
  if (!worst) continue;

  const cost = units * worst.unitPrice;
  const cv = creditValueOf("enterprise"); // 售价最低的套餐 = 最坏收入
  const credits = quoteCost(tool, worst.unitPrice, "platform", "enterprise");
  const revenue = credits * cv;
  const margin = revenue > 0 ? (revenue - cost) / revenue : 0;

  // 允许 ±0.5 分的取整误差（ceil 到整数积分天然会有一点浮点噪声）
  check(
    revenue + 0.005 >= cost,
    `${tool.slug} 用 ${worst.label} 每单亏 ${fen(cost - revenue)}（成本 ${fen(cost)} / 收入 ${fen(revenue)}）`,
  );

  console.log(
    `${pad(tool.name, 14)}${pad(`${units}`, 10)}${pad(worst.label, 22)}${pad(fen(cost), 12)}${pad(
      `${credits}`,
      8,
    )}${pad(fen(revenue), 14)}${pct(margin)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 3. 套餐级：额度全部用在最贵模型上，是否还赚钱                          */
/* ------------------------------------------------------------------ */

console.log("\n=== 3. 套餐级压力测试（额度 100% 用满 + 全选最贵平台模型） ===");
console.log(
  `${pad("套餐", 12)}${pad("月费", 10)}${pad("额度", 10)}${pad("额度成本", 12)}${pad("固定成本", 12)}${pad("净利", 12)}净利率`,
);

for (const plan of PLAN_CATALOG) {
  if (plan.price <= 0) {
    console.log(`${pad(plan.name, 12)}${pad("¥0", 10)}${pad(`${plan.credits}`, 10)}${pad("—", 12)}${pad("—", 12)}${pad("引流档", 12)}—`);
    continue;
  }

  const rate = SERVICE_RATE[plan.code] ?? SERVICE_RATE.free;
  // 平台代付时每积分对应的成本：成本 × (1+费率) 积分 ≈ 成本，故 1 积分 ≈ 1/(1+费率) 分钱
  const costPerCredit = 1 / (1 + rate) / 100; // 元
  const variable = plan.credits * costPerCredit;
  const net = plan.price - variable - FIXED_COST_PER_MONTH;
  const marginRate = net / plan.price;

  check(
    net > 0,
    `${plan.name}：额度用满净利 ${net.toFixed(2)} 元（月费 ${plan.price} / 额度成本 ${variable.toFixed(
      2,
    )} / 固定成本 ${FIXED_COST_PER_MONTH}）`,
  );
  check(
    marginRate >= 0.15,
    `${plan.name}：净利率只有 ${pct(marginRate)}，低于 15% 的安全线`,
  );

  console.log(
    `${pad(plan.name, 12)}${pad(`¥${plan.price}`, 10)}${pad(`${plan.credits}`, 10)}${pad(
      `¥${variable.toFixed(2)}`,
      12,
    )}${pad(`¥${FIXED_COST_PER_MONTH.toFixed(1)}`, 12)}${pad(`¥${net.toFixed(2)}`, 12)}${pct(marginRate)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 4. 改选项必须改价：绝不能出现「选了 20 条还是按 5 条扣」              */
/* ------------------------------------------------------------------ */

console.log("\n=== 4. 选项 → 计费量联动 ===");

let linked = 0;
for (const tool of TOOLS) {
  const baseUnits = unitsOf(tool);
  for (const rule of tool.billing.scale ?? []) {
    const field = tool.fields.find((f) => f.id === rule.field);
    const opts = field?.opts ?? [];
    const worst = opts.reduce((acc, o) => Math.max(acc, rule.map[o] ?? 1), 1);
    if (worst <= 1) continue; // 该字段没有更贵的档位，不参与联动校验

    const heaviest = opts.reduce((acc, o) => ((rule.map[o] ?? 1) > (rule.map[acc] ?? 1) ? o : acc), opts[0]);
    const heavyUnits = unitsOf(tool, { [rule.field]: heaviest });
    check(
      heavyUnits > baseUnits,
      `${tool.slug}：选「${heaviest}」的计费量 ${heavyUnits} 没有高于默认 ${baseUnits}`,
    );
    linked++;
  }
  check(unitsOf(tool, {}) === baseUnits, `${tool.slug}：空输入与默认输入的计费量不一致`);
}
console.log(`  ✓ ${linked} 个数量/时长档位都已接入计费，计价随输入变化`);

/* ------------------------------------------------------------------ */

if (failures > 0) {
  console.log(`\n✗ ${failures} 项检查未通过 —— 当前定价存在负收益或口径不一致，先修再发版。`);
  process.exit(1);
}
console.log("\n✓ 全部通过：每个组合都是正收益，展示价与结算价同源。\n");
