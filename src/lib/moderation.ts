/**
 * 内容审查：先用规则命中关键词，再给出可读建议。
 * 命中不阻断生成，但会写入 moderation_records 并在结果页顶部提示——
 * 这和文档里「高风险内容进入人工审核队列」的处理方式一致。
 */

export interface ModerationHit {
  term: string;
  level: "warn" | "block";
  rule: string;
  suggestion: string;
}

export interface ModerationVerdict {
  level: "pass" | "warn" | "block";
  hits: ModerationHit[];
  suggestion: string;
}

interface Rule {
  id: string;
  label: string;
  level: "warn" | "block";
  pattern: RegExp;
  suggestion: string;
}

const RULES: Rule[] = [
  {
    id: "absolute",
    label: "绝对化用语",
    level: "block",
    pattern: /(最好|最佳|最强|最低价|最高级|第一品牌|全国第一|唯一|顶级|国家级|世界级|极致|永久)/g,
    suggestion: "改用可验证的表述，如「在本店 12 款中销量第一（2026 年 9 月数据）」。",
  },
  {
    id: "medical",
    label: "医疗功效承诺",
    level: "block",
    pattern: /(治疗|治愈|根治|疗效|抗癌|降血压|降血糖|包治|痊愈)/g,
    suggestion: "食品与化妆品不得宣称医疗功效，改为描述使用感受。",
  },
  {
    id: "guarantee",
    label: "不可兑现的保证",
    level: "warn",
    pattern: /(100%|百分百|保证|无条件|稳赚|包过|零风险|绝对安全)/g,
    suggestion: "改为条件化表述，并说明适用前提与免责范围。",
  },
  {
    id: "urgency",
    label: "虚假紧迫感",
    level: "warn",
    pattern: /(最后一天|仅此一次|错过不再|限时秒杀|马上涨价)/g,
    suggestion: "如属实需标注活动起止时间与库存依据，避免无依据的紧迫话术。",
  },
  {
    id: "compare",
    label: "对比贬低",
    level: "warn",
    pattern: /(吊打|秒杀同行|碾压|比.*差远了)/g,
    suggestion: "对比需注明对比对象、维度与依据，避免贬低同行。",
  },
];

export function moderate(text: string): ModerationVerdict {
  const hits: ModerationHit[] = [];
  for (const rule of RULES) {
    const found = text.match(rule.pattern);
    if (!found) continue;
    const unique = Array.from(new Set(found)).slice(0, 4);
    for (const term of unique) {
      hits.push({ term, level: rule.level, rule: rule.label, suggestion: rule.suggestion });
    }
  }

  const level: ModerationVerdict["level"] = hits.some((h) => h.level === "block")
    ? "block"
    : hits.length
      ? "warn"
      : "pass";

  return {
    level,
    hits: hits.slice(0, 12),
    suggestion:
      level === "pass"
        ? "未命中风险规则。发布前仍建议人工核对价格、时间与资质表述。"
        : `命中 ${hits.length} 处，建议按提示逐条改写后再发布。`,
  };
}
