/**
 * 工具目录 —— 15 个能力，五个能力域
 * 表单 schema 与 prototype-v2.html 的 TOOL_SCHEMA 一一对应，
 * 这里补充了 id（用于任务输入与 Prompt 拼装）和 icon / art 元数据。
 */

export type SectionId = "copy" | "image" | "video" | "avatar" | "growth";
export type ToolKind = "copy" | "image" | "audio" | "video";
export type FieldType = "text" | "textarea" | "select" | "picks" | "upload" | "range";

export interface ToolField {
  id: string;
  type: FieldType;
  label: string;
  ph?: string;
  opts?: string[];
  /** 与 opts 对齐的色值，用于色板型 picks */
  colors?: string[];
  multi?: boolean;
  /** 占满两列 */
  full?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  suffix?: string;
  /** 单位放在数值后面（60%），否则放前面（×1） */
  after?: boolean;
  uploadCta?: string;
  uploadNote?: string;
  accept?: string;
}

/**
 * 计费口径。**唯一的真相**：卡片上写的积分、提交时扣的积分，都由它换算出来。
 *
 * base 是「默认输入」下的计费量；scale / perChars 描述输入变化时计费量怎么变。
 * 之所以不写死一个 creditCost，是因为同一个工具出 1 张图和出 9 张图、
 * 出 15 秒片和出 60 秒片的成本差好几倍，写死必然有一头是错的。
 */
export interface BillingRule {
  /** 默认输入下的计费量（千 token / 张 / 秒 / 千字符） */
  base: number;
  /** 选项 → 倍率，与 base 相乘；未命中按 1 处理 */
  scale?: Array<{ field: string; map: Record<string, number> }>;
  /** 按文案字数换算计费量（units = 字数 / charsPerUnit，取与 base 的较大者） */
  perChars?: { field: string; charsPerUnit: number };
  /**
   * 明确声明**不参与计费**的字段，必须同时写进 billingNote 说明原因。
   * 例：超级混剪的「变体数量」只影响文案组合矩阵，实际只渲染 2 款样片，
   * 所以计费不随它变 —— 与其假装按 20 条收费，不如把话说清楚。
   * scripts/check-margin.ts 会拿这个白名单核对，漏写就报错。
   */
  ignored?: string[];
}

export interface ToolDef {
  slug: string;
  section: SectionId;
  name: string;
  /** 卡片副标题 */
  tagline: string;
  kind: ToolKind;
  /**
   * 无实测样本时的耗时基线（秒）。有实测数据时以实测中位数为准，
   * 见 lib/ai/tool-quotes.ts —— 这里的值只在冷启动阶段兜底。
   */
  etaBaseline: number;
  /**
   * 计费量口径。真实扣费 = unitsOf(tool, input) × 模型单价 × (1 + 套餐费率)，
   * 卡片、配置页预览、服务端扣费三处共用同一函数（lib/domain/pricing.ts）。
   */
  billing: BillingRule;
  /** 计费方式的补充说明，展示在价格旁（例如「按出图张数计费」） */
  billingNote?: string;
  badge?: "new" | "hot";
  icon: IconName;
  art: string;
  /** 产出物说明，出现在配置页右侧 */
  outcome: string;
  fields: ToolField[];
}

export type IconName =
  | "pen"
  | "tag"
  | "bulb"
  | "mask"
  | "palette"
  | "layout"
  | "wave"
  | "film"
  | "layers"
  | "store"
  | "uservideo"
  | "sticker"
  | "flame"
  | "scan"
  | "frame";

export interface SectionDef {
  id: SectionId;
  name: string;
  en: string;
  desc: string;
}

export const SECTIONS: SectionDef[] = [
  { id: "copy", name: "AI 文案", en: "COPYWRITING", desc: "从主题到成稿的完整写作链路" },
  { id: "image", name: "图片与素材", en: "VISUAL & AUDIO", desc: "画面、版面与声音素材" },
  { id: "video", name: "视频工坊", en: "VIDEO", desc: "素材进、成片出的流水线" },
  { id: "avatar", name: "AI 数字人", en: "AVATAR", desc: "不用出镜的口播与人设" },
  { id: "growth", name: "增长运营", en: "GROWTH", desc: "用热点和数据驱动内容" },
];

const T = (label: string, id: string, extra: Partial<ToolField> = {}): ToolField => ({
  id,
  type: "text",
  label,
  ...extra,
});

const TA = (label: string, id: string, extra: Partial<ToolField> = {}): ToolField => ({
  id,
  type: "textarea",
  label,
  ...extra,
});

const S = (label: string, id: string, opts: string[], extra: Partial<ToolField> = {}): ToolField => ({
  id,
  type: "select",
  label,
  opts,
  ...extra,
});

const P = (label: string, id: string, opts: string[], extra: Partial<ToolField> = {}): ToolField => ({
  id,
  type: "picks",
  label,
  opts,
  ...extra,
});

const UP = (label: string, id: string, cta: string, note: string, accept = "image/*,video/*"): ToolField => ({
  id,
  type: "upload",
  label,
  uploadCta: cta,
  uploadNote: note,
  accept,
  full: true,
});

export const TOOLS: ToolDef[] = [
  // ---------------- AI 文案 ----------------
  {
    slug: "copy-smart",
    section: "copy",
    name: "智能文案",
    tagline: "给一个想法，产出标题、卖点、正文与 CTA。",
    kind: "copy",
    etaBaseline: 20,
    billing: { base: 4, scale: [{ field: "length", map: { "短 · 150 字": 0.6, "标准 · 400 字": 1, "长 · 800 字": 1.8 } }] },
    billingNote: "按篇幅计费（标准 400 字为基准）",
    badge: "hot",
    icon: "pen",
    art: "/assets/tools/copy-smart.jpg",
    outcome: "标题 3 版 / 卖点 3 条 / 正文 / CTA / 风险提示",
    fields: [
      T("产品 / 主题", "topic", { ph: "例如：春季限定燕麦拿铁", required: true, full: true }),
      S("文案类型", "type", ["短视频口播", "小红书笔记", "公众号长文", "电商详情页"]),
      S("语气", "tone", ["有网感 · 轻快", "专业可信", "故事感", "高转化"]),
      T("目标人群", "audience", { ph: "例如：一二线 25–35 岁白领" }),
      S("篇幅", "length", ["短 · 150 字", "标准 · 400 字", "长 · 800 字"]),
      TA("核心卖点 / 补充信息", "points", {
        ph: "一行一个卖点：0 蔗糖 / 燕麦奶基底 / 春季限定包装",
        full: true,
      }),
    ],
  },
  {
    slug: "copy-product",
    section: "copy",
    name: "产品文案",
    tagline: "把产品参数翻译成用户听得懂的卖点。",
    kind: "copy",
    etaBaseline: 25,
    billing: { base: 5.5 },
    icon: "tag",
    art: "/assets/tools/copy-product.jpg",
    outcome: "卖点排序 / 详情页文案 / 广告语 / 禁用承诺检查",
    fields: [
      T("产品名称", "product", { ph: "例如：轻氧空气炸锅 AF-320", required: true, full: true }),
      S("品类", "category", ["食品饮料", "美妆个护", "家居日用", "3C 数码", "服饰鞋包", "母婴"]),
      T("价格带", "price", { ph: "例如：¥299" }),
      TA("产品参数", "specs", { ph: "容量 5L / 功率 1500W / 8 种模式…", full: true }),
      TA("核心卖点", "selling", { ph: "你希望被记住的 3 个点", full: true }),
    ],
  },
  {
    slug: "copy-topic",
    section: "copy",
    name: "爆款选题",
    tagline: "结合赛道与热点，给出可执行的选题清单。",
    kind: "copy",
    etaBaseline: 30,
    billing: { base: 5, scale: [{ field: "count", map: { "5 个": 1, "10 个": 1.8, "20 个": 3.2 } }] },
    billingNote: "按输出数量计费",
    icon: "bulb",
    art: "/assets/tools/copy-topic.jpg",
    outcome: "选题卡（标题 / 切入角 / 预估热度 / 竞争度）",
    fields: [
      S("行业赛道", "industry", ["本地生活", "美妆个护", "食品饮料", "母婴育儿", "知识付费", "3C 数码"]),
      S("目标平台", "platform", ["抖音", "小红书", "视频号", "公众号"]),
      T("目标人群", "audience", { ph: "例如：宝妈 / 大学生 / 门店老板", full: true }),
      TA("近期热点或关键词", "keywords", {
        ph: "例如：开学季、多巴胺穿搭、AI 换脸…",
        full: true,
      }),
      P("输出数量", "count", ["5 个", "10 个", "20 个"], { full: true }),
    ],
  },
  {
    slug: "copy-persona",
    section: "copy",
    name: "人设文案",
    tagline: "把账号语气与价值观沉淀成可复用的写作人格。",
    kind: "copy",
    etaBaseline: 20,
    billing: { base: 4 },
    badge: "new",
    icon: "mask",
    art: "/assets/tools/copy-persona.jpg",
    outcome: "人设档案 / 口吻样例 3 条 / 禁用表达",
    fields: [
      T("账号名称", "account", { ph: "例如：林小满的咖啡日记", required: true }),
      S("人设定位", "positioning", ["行业专家", "门店老板", "素人分享", "虚拟 IP"]),
      P("性格关键词", "traits", ["真诚", "犀利", "温柔", "幽默", "克制", "专业"], {
        multi: true,
        full: true,
      }),
      T("口头禅 / 记忆点", "catchphrase", { ph: "例如：「说人话，讲真话」", full: true }),
      TA("价值观与禁区", "boundaries", { ph: "坚持什么、绝不说哪些话", full: true }),
    ],
  },

  // ---------------- 图片与素材 ----------------
  {
    slug: "image-gen",
    section: "image",
    name: "灵感成画",
    tagline: "文字 + 参考图，生成一组有方向的视觉素材。",
    kind: "image",
    etaBaseline: 40,
    billing: { base: 1, scale: [{ field: "count", map: { "1 张": 1, "2 张": 2, "4 张": 4 } }] },
    billingNote: "按出图张数计费",
    icon: "palette",
    art: "/assets/tools/image-gen.jpg",
    outcome: "多张 PNG（含缩略图与生成参数）",
    fields: [
      TA("画面描述", "prompt", {
        ph: "例如：清晨窗边的燕麦拿铁，暖光，浅景深，生活感",
        required: true,
        full: true,
      }),
      S("画面风格", "style", ["写实摄影", "电影感", "胶片颗粒", "3D 渲染", "极简平面"]),
      S("尺寸比例", "ratio", ["1:1", "3:4", "9:16", "16:9"]),
      UP("参考图", "ref", "上传参考图（可选）", "JPG / PNG，最多 3 张", "image/*"),
      P("生成数量", "count", ["1 张", "2 张", "4 张"], { full: true }),
    ],
  },
  {
    slug: "image-poster",
    section: "image",
    name: "海报设计",
    tagline: "活动信息自动排版，直出可发布的社媒海报。",
    kind: "image",
    etaBaseline: 35,
    billing: { base: 3 },
    billingNote: "按 3 张候选版式计费",
    icon: "layout",
    art: "/assets/tools/image-poster.jpg",
    outcome: "海报 PNG（真实字体排版，文字不会糊）",
    fields: [
      T("活动主题", "theme", { ph: "例如：双 11 全场 5 折", required: true, full: true }),
      T("主标题", "title", { ph: "例如：一年一次的诚意" }),
      T("副标题", "subtitle", { ph: "例如：11.1–11.11 限时开抢" }),
      T("活动时间", "when", { ph: "例如：2026-11-01 至 11-11" }),
      S("尺寸", "size", ["1080×1440 竖版", "1080×1080 方版", "1920×1080 横版"]),
      P("主色", "palette", ["墨金", "朱红", "松绿", "墨蓝", "米白"], {
        colors: ["#D8A85E", "#C0504A", "#5C8A6E", "#3C5A7D", "#EDE4D3"],
        full: true,
      }),
    ],
  },
  {
    slug: "audio-tts",
    section: "image",
    name: "音频合成",
    tagline: "配音、BGM 与音效自动对齐成一条声音轨道。",
    kind: "audio",
    etaBaseline: 25,
    billing: { base: 0.3, perChars: { field: "script", charsPerUnit: 1000 } },
    billingNote: "按文案字符数计费（每千字符一档）",
    icon: "wave",
    art: "/assets/tools/audio-tts.jpg",
    outcome: "WAV 音轨 + 波形 + 分段时间戳",
    fields: [
      TA("配音文案", "script", {
        ph: "粘贴需要配音的文字，支持多段",
        required: true,
        full: true,
      }),
      S("音色", "voice", ["女声 · 温柔", "女声 · 元气", "男声 · 沉稳", "男声 · 磁性", "童声"]),
      S("背景音乐", "bgm", ["轻快", "温暖", "悬疑", "无 BGM"]),
      {
        id: "speed",
        type: "range",
        label: "语速",
        min: 0.8,
        max: 1.5,
        step: 0.1,
        value: 1,
        suffix: "×",
      },
      S("输出格式", "format", ["MP3 · 192kbps", "WAV · 无损"]),
    ],
  },

  // ---------------- 视频工坊 ----------------
  {
    slug: "video-movie",
    section: "video",
    name: "一键大片",
    tagline: "素材进来，节奏、转场、字幕、配乐一次成片。",
    kind: "video",
    etaBaseline: 180,
    billing: { base: 15, scale: [{ field: "duration", map: { "15 秒": 1, "30 秒": 2, "60 秒": 4 } }] },
    billingNote: "按所选成片时长计费",
    badge: "hot",
    icon: "film",
    art: "/assets/tools/video-movie.jpg",
    outcome: "分镜表 / 关键帧序列 / 时间轴 JSON / 可播放预览",
    fields: [
      UP("素材", "media", "上传视频或图片素材", "MP4 / MOV / JPG，单个 ≤ 200MB，至少 3 段"),
      S("成片比例", "ratio", ["9:16 竖屏", "16:9 横屏", "1:1 方屏"]),
      S("时长", "duration", ["15 秒", "30 秒", "60 秒"]),
      S("节奏", "pace", ["快 · 强卡点", "中 · 叙事", "慢 · 氛围"]),
      S("字幕样式", "subtitle", ["大字幕 · 描边", "简洁无底", "花字 · 综艺"]),
      S("配乐", "music", ["智能推荐", "热门 BGM", "无配乐"]),
    ],
  },
  {
    slug: "video-mix",
    section: "video",
    name: "超级混剪",
    tagline: "多套开头 × BGM × 字幕批量组合，一次出片。",
    kind: "video",
    etaBaseline: 300,
    billing: { base: 50, ignored: ["count"] },
    billingNote: "按 25 秒 × 2 款样片渲染计费；更多变体只改文案组合矩阵，不额外渲染",
    icon: "layers",
    art: "/assets/tools/video-mix.jpg",
    outcome: "N 个变体的分镜与关键帧，附组合矩阵",
    fields: [
      UP("素材", "media", "上传素材包", "支持批量上传，建议同题材 10 段以上"),
      S("开头模板", "opening", ["痛点提问", "结果前置", "悬念开场", "随机"]),
      S("输出比例", "ratio", ["9:16 竖屏", "16:9 横屏"]),
      P("变体数量", "count", ["5 条", "10 条", "20 条"], { full: true }),
      TA("文案变量", "vars", {
        ph: "一行一条，系统会与开头 / BGM 交叉组合",
        full: true,
      }),
    ],
  },
  {
    slug: "video-store",
    section: "video",
    name: "门店引流",
    tagline: "给门店生成团购、到店与活动宣传视频。",
    kind: "video",
    etaBaseline: 120,
    billing: { base: 30 },
    billingNote: "按 30 秒成片计费",
    icon: "store",
    art: "/assets/tools/video-store.jpg",
    outcome: "门店视频分镜 / 口播稿 / 团购卡片画面",
    fields: [
      T("门店名称", "shop", { ph: "例如：林记咖啡 · 光谷店", required: true }),
      T("城市 / POI", "poi", { ph: "例如：武汉 · 光谷世界城" }),
      TA("团购套餐", "combo", {
        ph: "例如：双人下午茶 ¥59（2 杯拿铁 + 1 份可颂）",
        full: true,
      }),
      T("活动时间", "when", { ph: "例如：即日起至 11-30" }),
      S("视频模板", "template", ["探店口播", "套餐展示", "到店实拍", "节日活动"]),
    ],
  },

  // ---------------- AI 数字人 ----------------
  {
    slug: "avatar-talking",
    section: "avatar",
    name: "口播数字人",
    tagline: "输入文案即可生成真人口播，无需出镜。",
    kind: "video",
    etaBaseline: 90,
    billing: { base: 15, perChars: { field: "script", charsPerUnit: 5 } },
    billingNote: "按口播时长计费（约 5 字 1 秒，最低 15 秒）",
    icon: "uservideo",
    art: "/assets/tools/avatar-talking.jpg",
    outcome: "口播分镜 / 逐句时间码 / 主播关键帧",
    fields: [
      TA("口播文案", "script", {
        ph: "建议 60–120 字，口语化更自然",
        required: true,
        full: true,
      }),
      S("数字人形象", "presenter", ["知性女性", "商务男性", "邻家女生", "门店店员"]),
      S("声音", "voice", ["跟随形象", "温柔女声", "沉稳男声", "元气少女"]),
      S("背景", "bg", ["纯色", "办公室", "门店", "虚化实景"]),
      S("画面比例", "ratio", ["9:16 竖屏", "16:9 横屏"]),
      P("字幕", "subtitle", ["自动字幕", "大字幕", "无字幕"], { full: true }),
    ],
  },
  {
    slug: "avatar-net",
    section: "avatar",
    name: "网感视频",
    tagline: "花字、贴纸、弹幕与热门音效，一次补齐平台氛围。",
    kind: "video",
    etaBaseline: 120,
    billing: { base: 20 },
    billingNote: "按 20 秒成片处理计费",
    badge: "new",
    icon: "sticker",
    art: "/assets/tools/avatar-net.jpg",
    outcome: "网感分镜 / 花字与贴纸层 / 音效点位",
    fields: [
      UP("原始视频", "media", "上传需要加工的成片", "MP4 / MOV，时长 ≤ 5 分钟"),
      S("花字风格", "flower", ["综艺大字", "手写便签", "新闻标题", "极简"]),
      S("贴纸主题", "sticker", ["热门梗图", "情绪符号", "节日氛围", "不加贴纸"]),
      S("弹幕", "danmaku", ["开启", "关闭"]),
      {
        id: "sfx",
        type: "range",
        label: "音效强度",
        min: 0,
        max: 100,
        step: 10,
        value: 60,
        suffix: "%",
        after: true,
      },
    ],
  },

  // ---------------- 增长运营 ----------------
  {
    slug: "growth-trend",
    section: "growth",
    name: "一键追爆",
    tagline: "发现正在上涨的话题，快速转成你的跟进内容。",
    kind: "copy",
    etaBaseline: 30,
    billing: { base: 5.5, scale: [{ field: "count", map: { "3 条": 1, "5 条": 1.6, "10 条": 3 } }] },
    billingNote: "按输出数量计费",
    icon: "flame",
    art: "/assets/tools/growth-trend.jpg",
    outcome: "跟进脚本 / 热度曲线 / 发布窗口建议",
    fields: [
      T("热点关键词", "keyword", { ph: "例如：多巴胺穿搭、开学第一课", required: true, full: true }),
      S("平台", "platform", ["抖音", "小红书", "视频号", "微博"]),
      S("跟进方式", "approach", ["同款脚本", "反向观点", "行业延伸", "本地化改编"]),
      S("热度窗口", "window", ["近 24 小时", "近 3 天", "近 7 天"]),
      S("输出数量", "count", ["3 条", "5 条", "10 条"]),
    ],
  },
  {
    slug: "growth-reverse",
    section: "growth",
    name: "视频反推",
    tagline: "从一条爆款视频，反推可复用的结构与分镜。",
    kind: "copy",
    etaBaseline: 40,
    billing: { base: 8 },
    icon: "scan",
    art: "/assets/tools/growth-reverse.jpg",
    outcome: "分镜表 / 结构拆解 / 复刻建议",
    fields: [
      T("视频链接", "url", {
        ph: "粘贴抖音 / 小红书 / 视频号链接",
        required: true,
        full: true,
      }),
      P("拆解维度", "dims", ["脚本结构", "镜头语言", "节奏卡点", "文案钩子", "发布策略"], {
        multi: true,
        full: true,
      }),
      S("输出形式", "format", ["文字脚本", "分镜表", "脚本 + 分镜"]),
      S("复刻程度", "depth", ["结构复刻", "换赛道改编", "只取钩子"]),
    ],
  },
  {
    slug: "growth-cover",
    section: "growth",
    name: "网感封面",
    tagline: "从关键帧出发，生成高点击率的封面候选。",
    kind: "image",
    etaBaseline: 40,
    billing: { base: 3, scale: [{ field: "count", map: { "3 张": 1, "6 张": 2, "9 张": 3 } }] },
    billingNote: "按封面张数计费",
    icon: "frame",
    art: "/assets/tools/growth-cover.jpg",
    outcome: "封面候选 PNG（按尺寸出图，含文案安全区）",
    fields: [
      UP("视频 / 关键帧", "media", "上传视频或截图", "PNG / JPG / MP4，建议竖版原图"),
      T("封面文案", "copy", {
        ph: "例如：我劝你别再乱买咖啡豆了",
        required: true,
        full: true,
      }),
      S("风格", "style", ["大字报", "真人情绪", "对比冲突", "极简留白"]),
      S("尺寸", "size", ["3:4 竖版", "9:16 竖版", "16:9 横版"]),
      P("候选数量", "count", ["3 张", "6 张", "9 张"], { full: true }),
    ],
  },
];

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.slug, t]),
);

export function getTool(slug: string): ToolDef | undefined {
  return TOOL_MAP[slug];
}

export function toolsBySection(section: SectionId): ToolDef[] {
  return TOOLS.filter((t) => t.section === section);
}

/** 任务的默认输入值（picks 选中第一项、range 用默认值） */
export function defaultInput(tool: ToolDef): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of tool.fields) {
    if (f.type === "picks") out[f.id] = f.opts?.[0] ?? "";
    else if (f.type === "select") out[f.id] = f.opts?.[0] ?? "";
    else if (f.type === "range") out[f.id] = f.value ?? 0;
    else out[f.id] = "";
  }
  return out;
}
