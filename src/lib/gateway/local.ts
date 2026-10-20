import type { Block } from "@/lib/domain/blocks";
import { blocksToPlain } from "@/lib/domain/blocks";
import type { ProviderAdapter, TextRequest, TextResult } from "./types";

/**
 * 本地规则引擎 Provider。
 * 在未配置任何模型密钥时兜底：用确定性规则把结构化输入转成可用文案，
 * 同一份输入永远得到同一份输出（便于测试与对比）。
 * 它不做语义推理，能力边界写在 README 里，界面也会标注「本地规则引擎」。
 */

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const pick = <T,>(arr: T[], seed: number): T => arr[seed % arr.length];

const str = (v: unknown, fallback = "") =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

/** 卖点 → 收益句。命中关键词就给具体收益，未命中给通用句 */
const BENEFIT_RULES: Array<[RegExp, (p: string) => string]> = [
  [/0\s*糖|无糖|零糖|低糖/, (p) => `${p}：喝完不齁不齁嗓，下午也不用为糖分还账`],
  [/燕麦|植物基|乳糖/, (p) => `${p}：乳糖不耐也能安心喝，口感照样厚`],
  [/便携|随身|口袋|小包装/, (p) => `${p}：通勤包里塞一个，不用为「想用的时候没有」发愁`],
  [/续航|电池|充电/, (p) => `${p}：一次充电撑过整天，出差不用惦记插座`],
  [/轻|重量|克重/, (p) => `${p}：上手第一下就能感觉到，久用不累`],
  [/快|速|分钟|秒/, (p) => `${p}：把等待压到最短，忙碌时段也能按流程走完`],
  [/静音|噪音|低噪/, (p) => `${p}：晚上用不吵到家人，合租也放心`],
  [/耐用|材质|不锈钢|铝合金/, (p) => `${p}：天天用的东西，耐用比参数好看更重要`],
  [/省|节能|功耗/, (p) => `${p}：长期用下来，省下的钱比标价差更有说服力`],
  [/限定|首发|新品|季节/, (p) => `${p}：错过这一批要等下一季，适合先试后囤`],
  [/售后|保修|质保/, (p) => `${p}：出问题有人管，比便宜几十块更安心`],
  [/口味|风味|香气|醇/, (p) => `${p}：风味层次是喝/用出来的，不是写在包装上的`],
];

const toBenefit = (point: string) => {
  const p = point.replace(/^[\s·•\-*]+/, "").trim();
  const rule = BENEFIT_RULES.find(([re]) => re.test(p));
  if (rule) return rule[1](p);
  return `${p}：这一条决定了日常使用是否顺畅，建议放进第一屏`;
};

const splitPoints = (raw: string) =>
  raw
    .split(/[\n/、,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

const TITLE_PATTERNS: Record<string, (t: string, a: string, b: string) => string[]> = {
  短视频口播: (t, a, b) => [
    `${t}，先别急着下单`,
    `关于${t}，我只讲三句实话`,
    `${a}都在问的${t}，${b}`,
  ],
  小红书笔记: (t, a) => [
    `${t}｜我踩过的 3 个坑`,
    `把${t}做到位的 5 个细节（${a}版）`,
    `${t}真的值得吗？用了一周再说`,
  ],
  公众号长文: (t) => [
    `${t}：为什么现在值得重新看一遍`,
    `从${t}说起，我们可能误解了什么`,
    `${t}背后的三个取舍`,
  ],
  电商详情页: (t, a, b) => [
    `${t} · 一次说清参数与场景`,
    `${t}，把「${b}」放进日常`,
    `${a}选的${t}：先看这 4 条`,
  ],
};

const OPENERS = [
  "先说结论：",
  "一句话讲清：",
  "如果只记一句：",
];

const CLOSERS: Record<string, string> = {
  短视频口播: "看到这里，先存下来，用的时候直接照着说。",
  小红书笔记: "以上都是自己用下来的体感，有问题评论区问，我尽量都回。",
  公众号长文: "如果你也在做类似的判断，欢迎把你的约束条件写下来，我们一起校准。",
  电商详情页: "参数都写在上面了，剩下的交给你的使用场景。",
};

function paragraphsFor(type: string, length: string): number {
  const base = type === "公众号长文" ? 3 : type === "小红书笔记" ? 3 : 2;
  const add = length.startsWith("长") ? 2 : length.startsWith("标准") ? 1 : 0;
  return base + add;
}

const LENGTH_NOTE: Record<string, string> = {
  短: "约 150 字",
  标准: "约 400 字",
  长: "约 800 字",
};

/* ------------------------- 各工具的组装器 ------------------------- */

function copySmart(input: Record<string, unknown>): Block[] {
  const topic = str(input.topic, "这个产品");
  const type = str(input.type, "短视频口播");
  const tone = str(input.tone, "有网感 · 轻快");
  const audience = str(input.audience, "目标用户");
  const length = str(input.length, "标准 · 400 字");
  const seed = hash(topic + type + tone);

  const points = splitPoints(str(input.points));
  const primary = points[0] ? toBenefit(points[0]).split("：")[0] : "把细节做好";
  const titles = (TITLE_PATTERNS[type] ?? TITLE_PATTERNS["短视频口播"])(topic, audience, primary);

  const blocks: Block[] = [
    { kind: "headline", text: pick(OPENERS, seed) + `${topic}，值得被认真讲一次` },
    { kind: "list", title: "标题候选", items: titles },
  ];

  if (points.length) {
    blocks.push({
      kind: "list",
      title: "核心卖点（已翻译成用户收益）",
      items: points.map(toBenefit),
    });
  }

  const lead = `${topic}最怕的不是没特点，而是特点讲不清。下面按${type}的节奏写，语气偏「${tone}」，面向${audience}。`;
  const bodyParts: string[] = [lead];

  if (points.length) {
    bodyParts.push(
      points
        .slice(0, 3)
        .map((p) => toBenefit(p))
        .join(type === "公众号长文" ? "。" : "；") + "。",
    );
  } else {
    bodyParts.push(
      `先说清它解决的是哪一类麻烦，再说清为什么是你来解决——这两句讲明白，${audience}才会继续往下看。`,
    );
  }

  const n = paragraphsFor(type, length);
  for (let i = bodyParts.length; i < n; i++) {
    bodyParts.push(
      pick(
        [
          `很多同类内容会在这里堆形容词，但真正让人下决定的是具体场景：什么时候用、用完什么感觉、不用会怎样。`,
          `把「${primary}」放在第一屏，第二屏再补充参数。参数是给已经动心的人做确认用的，不是用来翻盘的。`,
          `如果你面向的是${audience}，可以再加一句反向承诺：我们不建议谁买。愿意排除掉一部分人，可信度反而更高。`,
        ],
        seed + i,
      ),
    );
  }

  blocks.push({ kind: "text", title: `正文（${LENGTH_NOTE[length.split(" ")[0]] ?? "约 400 字"}）`, text: bodyParts.join("") });
  blocks.push({ kind: "quote", text: CLOSERS[type] ?? CLOSERS["短视频口播"] });
  blocks.push({
    kind: "list",
    title: "发布前检查",
    items: [
      "标题里的数字、价格、时间是否都有依据",
      "是否出现「最 / 第一 / 唯一 / 国家级」等绝对化用语",
      "卖点顺序：先收益，后参数",
      "CTA 只有一个动作，别让用户做选择",
    ],
  });

  return blocks;
}

function copyProduct(input: Record<string, unknown>): Block[] {
  const product = str(input.product, "该产品");
  const category = str(input.category, "家居日用");
  const price = str(input.price, "未标注价格带");
  const specs = splitPoints(str(input.specs));
  const selling = splitPoints(str(input.selling));
  const seed = hash(product + category);

  const blocks: Block[] = [
    { kind: "headline", text: `${product}｜把参数翻译成「所以你能」` },
    {
      kind: "text",
      title: "决策心理",
      text: `${category}品类的用户通常先看${price}这个价位能解决什么，再回头核对参数。所以卖点排序要按「场景痛点 → 收益 → 参数佐证」走，而不是按参数表顺序。`,
    },
  ];

  const ranked = (selling.length ? selling : specs).map(toBenefit);
  if (ranked.length) {
    blocks.push({ kind: "list", title: "卖点排序（可直接用）", items: ranked });
  }

  if (specs.length) {
    blocks.push({
      kind: "table",
      title: "参数 → 用户语言对照",
      columns: ["参数", "它在用户那边的意思"],
      rows: specs.map((s) => [s, toBenefit(s).split("：")[1] ?? "决定了日常体验是否顺畅"]),
    });
  }

  blocks.push({
    kind: "text",
    title: "详情页首屏文案",
    text: `${product}\n${ranked[0] ?? "把该做好的细节做好"}\n${price}｜${category}\n——先给结论，再给证据。`,
  });

  blocks.push({
    kind: "list",
    title: "广告语候选",
    items: [
      `${product}，${(ranked[0] ?? "好用").split("：")[0]}。`,
      `不是更复杂，是更省事。`,
      `${category}该有的样子，${price}能做到的部分。`,
    ],
  });

  blocks.push({
    kind: "list",
    title: "合规提醒",
    items: [
      "不承诺医疗、疗效、治愈类效果",
      "不使用「最 / 第一 / 唯一 / 顶级 / 国家级」等绝对化用语",
      "价格、销量、认证、检测报告需有可核验来源",
      "对比类表述需注明对比对象与依据",
    ],
  });

  void seed;
  return blocks;
}

function copyTopic(input: Record<string, unknown>): Block[] {
  const industry = str(input.industry, "本地生活");
  const platform = str(input.platform, "抖音");
  const audience = str(input.audience, "目标人群");
  const keywords = splitPoints(str(input.keywords));
  const count = Number(String(str(input.count, "5 个")).replace(/[^\d]/g, "")) || 5;
  const seed = hash(industry + platform + audience);

  const angles = [
    ["痛点型", "把大家忍着不说的问题挑明", "高", "中"],
    ["反常识型", "推翻一个行业默认做法", "中高", "低"],
    ["场景型", "绑定一个具体时刻/地点", "中", "中"],
    ["清单型", "一次性给全，收藏率高", "中高", "高"],
    ["对比型", "同类横评，天然有争议", "高", "高"],
    ["人物型", "用一个人物串起叙事", "中", "中低"],
    ["数据型", "用一个数字做记忆锚点", "中高", "中"],
  ] as const;

  const kw = keywords[0] ?? "当前赛道热点";
  const rows = Array.from({ length: Math.min(count, 10) }, (_, i) => {
    const a = angles[(seed + i) % angles.length];
    return [
      `${a[0]}｜${i === 0 ? `${kw}，${audience}其实不需要它` : `${kw}的 ${i + 1} 个真相`}`,
      a[1],
      a[2],
      a[3],
    ];
  });

  const blocks: Block[] = [
    { kind: "headline", text: `${industry} · ${platform} 选题清单（${rows.length} 条）` },
    {
      kind: "text",
      title: "选题逻辑",
      text: `按「痛点 / 反常识 / 场景 / 清单」四类铺开，保证不重复。热度是相对值，竞争度越高越需要更强的切入点。${keywords.length ? `本轮绑定的关键词：${keywords.join("、")}。` : ""}`,
    },
    { kind: "table", title: "选题卡", columns: ["标题", "切入角度", "预估热度", "竞争度"], rows },
    {
      kind: "list",
      title: "执行建议",
      items: [
        `${platform}前 3 秒决定完播，标题里至少留一个具体名词`,
        "同一天不要发两条同类型选题，会互相稀释",
        "清单型内容优先做，收藏率通常高于点赞率",
      ],
    },
  ];
  return blocks;
}

function copyPersona(input: Record<string, unknown>): Block[] {
  const account = str(input.account, "该账号");
  const positioning = str(input.positioning, "素人分享");
  const traits = str(input.traits, "真诚");
  const phrase = str(input.catchphrase, "说人话，讲真话");
  const boundaries = str(input.boundaries, "不承诺功效，不贬低同行");

  const traitList = splitPoints(traits);
  const seed = hash(account + positioning);

  return [
    { kind: "headline", text: `${account} 的人设档案` },
    {
      kind: "text",
      title: "一句话人设",
      text: `一个${positioning}视角的${traitList.join("、")}型表达者——讲自己的判断，不替品牌说话。`,
    },
    {
      kind: "list",
      title: "说话方式",
      items: [
        `称呼：对读者用「你」，不用「亲」「宝子」`,
        `句式：短句为主，${pick(["先说结论再解释", "先讲一个具体场景再给判断", "先承认不知道再讲知道的"], seed)}`,
        `节奏：每段不超过 3 行，重要的一句单独成段`,
        `情绪：${traitList.includes("幽默") ? "可以有玩笑，但不拿用户开玩笑" : "克制，不煽动"}`,
      ],
    },
    { kind: "quote", text: phrase },
    {
      kind: "list",
      title: "口吻样例",
      items: [
        `「${pick(["这事儿我试过，结论可能不太好听", "先说我踩的坑，再说正确做法", "我知道你想要一句话结论，那就先给结论"], seed)}」`,
        `「${pick(["这个价格我不劝你买，也不劝你别买", "如果你只做一件事，就做这个", "别急着抄作业，先看适不适合你"], seed + 1)}」`,
        `「${pick(["效果因人而异，这话我必须说在前面", "我能保证的是过程，不是结果", "到这里就够了，剩下的交给你的场景"], seed + 2)}」`,
      ],
    },
    {
      kind: "list",
      title: "禁区（触发即改写）",
      items: [
        ...splitPoints(boundaries),
        "绝对化用语：最、第一、唯一、国家级",
        "替用户做医疗、投资、法律判断",
      ],
    },
  ];
}

function growthTrend(input: Record<string, unknown>): Block[] {
  const keyword = str(input.keyword, "当前热点");
  const platform = str(input.platform, "抖音");
  const approach = str(input.approach, "同款脚本");
  const win = str(input.window, "近 24 小时");
  const count = Number(String(str(input.count, "3 条")).replace(/[^\d]/g, "")) || 3;
  const seed = hash(keyword + approach);

  const hooks = [
    `「${keyword}这事，${platform}上已经有人跑通了，但抄错了一步」`,
    `「先别跟${keyword}，先看这三个数据」`,
    `「${keyword}能火，是因为它踩中了一个说不出口的需求」`,
    `「我把${keyword}拆成了可复用的四步」`,
  ];

  const rows = Array.from({ length: Math.min(count, 6) }, (_, i) => [
    `脚本 ${i + 1}`,
    pick(hooks, seed + i),
    approach === "反向观点"
      ? "先立大众观点，再用一个反例推翻，最后给自己的判断"
      : approach === "本地化改编"
        ? "保留结构，把案例换成同城、同价位、同人群"
        : "痛点 → 论证 → 方法 → 动作",
    i === 0 ? "现在发布（窗口前段）" : `窗口 ${win} 内`,
  ]);

  return [
    { kind: "headline", text: `${keyword} · ${platform} 跟进方案` },
    {
      kind: "text",
      title: "判断",
      text: `热度还在上升期，适合「跟进」而不是「原创」。跟进方式选的是「${approach}」，注意不要把原内容的具体人名、原句、素材搬过来——那是侵权，不是借鉴。`,
    },
    { kind: "table", title: "可执行脚本", columns: ["编号", "开头 3 秒", "主体结构", "发布时机"], rows },
    {
      kind: "list",
      title: "风险与节奏",
      items: [
        "热点窗口通常 48–72 小时，超过就转成常青内容",
        "不要在同一平台同一时间批量发同质内容",
        "准备好一条「如果被质疑」的回应，别现场想",
      ],
    },
  ];
}

function growthReverse(input: Record<string, unknown>): Block[] {
  const url = str(input.url, "该视频");
  const dims = splitPoints(str(input.dims, "脚本结构,镜头语言,节奏卡点"));
  const format = str(input.format, "脚本 + 分镜");
  const depth = str(input.depth, "结构复刻");
  const seed = hash(url + depth);

  const shots = [
    ["01", "0–3s", "近景人脸 + 大字幕", "先给结论，不留铺垫", "抢注意力"],
    ["02", "3–8s", "场景空镜 + 手部特写", "提出问题：为什么大多数人做错了", "建立张力"],
    ["03", "8–18s", "分点演示，三步各一个镜头", "给出方法，一步一句", "交付价值"],
    ["04", "18–25s", "对比画面（之前 / 之后）", "用对比代替形容词", "制造可信度"],
    ["05", "25–30s", "回到人脸，直视镜头", "一句反向承诺 + 一个动作", "收口转化"],
    ["06", "30–32s", "品牌/门店信息卡", "留联系方式，不做二次说服", "承接流量"],
  ];

  const blocks: Block[] = [
    { kind: "headline", text: "视频结构拆解" },
    {
      kind: "text",
      title: "可复用的是什么",
      text: `这条内容的可复用点是结构，不是台词。复刻程度选的是「${depth}」：保留${dims.slice(0, 3).join("、")}的骨架，替换掉具体的产品、人物和场景。原句、原画面、原 BGM 都不要直接搬。`,
    },
  ];

  if (format !== "文字脚本") {
    blocks.push({
      kind: "table",
      title: "分镜表",
      columns: ["镜号", "时长", "画面", "台词 / 字幕", "作用"],
      rows: shots,
    });
  }

  blocks.push({
    kind: "text",
    title: "文字脚本（可直接念）",
    text: [
      `开头：${shots[0][3]}。`,
      `中段：${shots[2][3]}，每一点都要有一个具体数字或场景。`,
      `结尾：${shots[4][3]}，把动作说成一个指令，不要说「欢迎了解」。`,
    ].join("\n"),
  });

  blocks.push({
    kind: "list",
    title: `拆解维度命中情况`,
    items: dims.map((d) => {
      const map: Record<string, string> = {
        脚本结构: "5 段式：结论 → 问题 → 方法 → 对比 → 收口",
        镜头语言: "近景为主，穿插手部特写与空镜，无运镜炫技",
        节奏卡点: "每 5–7 秒一个信息点，音乐在 8s / 25s 有两次起伏",
        文案钩子: "反向承诺（不建议谁买）+ 具体数字",
        发布策略: "工作日 12:00–13:00 或 20:00–22:00，配一条置顶评论承接",
      };
      return `${d}：${map[d] ?? "需要人工补充判断"}`;
    }),
  });

  void seed;
  return blocks;
}

export function localBlocks(slug: string, input: Record<string, unknown>): Block[] {
  switch (slug) {
    case "copy-smart":
      return copySmart(input);
    case "copy-product":
      return copyProduct(input);
    case "copy-topic":
      return copyTopic(input);
    case "copy-persona":
      return copyPersona(input);
    case "growth-trend":
      return growthTrend(input);
    case "growth-reverse":
      return growthReverse(input);
    default:
      return [
        { kind: "headline", text: "本地引擎暂不支持该工具" },
        { kind: "text", text: "请配置模型密钥后重试。" },
      ];
  }
}

export const localProvider: ProviderAdapter = {
  id: "local",
  label: "本地规则引擎",
  available: true,
  async generateText(req: TextRequest): Promise<TextResult> {
    const started = Date.now();
    // user 里约定以 ###INPUT### 分隔的结构化载荷
    const marker = "###INPUT###";
    const idx = req.user.indexOf(marker);
    const payload = idx >= 0 ? req.user.slice(idx + marker.length) : "{}";
    let parsed: { slug?: string; input?: Record<string, unknown> } = {};
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = {};
    }
    const blocks = localBlocks(parsed.slug ?? "", parsed.input ?? {});
    const text = JSON.stringify({ blocks, plain: blocksToPlain(blocks) });
    return {
      text,
      provider: "local",
      model: "local-rule-engine",
      usage: { inputTokens: 0, outputTokens: 0, costCny: 0 },
      latencyMs: Date.now() - started,
      local: true,
    };
  },
};
