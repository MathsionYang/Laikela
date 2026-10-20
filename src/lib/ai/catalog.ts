/**
 * 内置模型目录（Catalog）——「代码即真相」。
 *
 * 为什么放代码里：模型清单、协议、单价属于发版内容，跟着版本走，
 * 数据库只存「运行时开关 + 覆盖项」（model_catalog 表），启动时同步。
 * 这样新增模型 = 加一条 spec + 发版，不需要手工改库。
 */
export type ModelKind = "text" | "image" | "video" | "audio";

export type ModelProtocol =
  | "openai-chat" // OpenAI 协议文本：/chat/completions（DeepSeek、豆包、任意兼容端点）
  | "ark-image" // 豆包 Image 2.5，/images/generations（与 OpenAI 出图协议一致）
  | "ark-video" // 豆包 Seedance 2.5，/contents/generations/tasks
  | "ark-tts" // 豆包语音合成，/audio/speech
  | "local"; // 本地规则引擎 / 本地渲染，无外部依赖

/**
 * 供应商维度。
 * custom = 用户自己接的 OpenAI 兼容端点（URL / 模型名 / Key 都是他填的），
 * 这类模型的凭证在 model_endpoints 表里，不在 provider_credentials。
 */
export type ProviderKey = "deepseek" | "doubao" | "local" | "custom";

export interface ModelSpec {
  /** 全局唯一，前端与服务端都用它引用模型 */
  key: string;
  /** 供应商 id，也是 BYOK 凭证的归属维度 */
  provider: ProviderKey;
  /** provider=custom 时指向 model_endpoints.id */
  endpointId?: string;
  vendor: string;
  label: string;
  kind: ModelKind;
  protocol: ModelProtocol;
  /** 相对 baseUrl 的路径；local 留空 */
  path: string;
  /** 传给供应商的 model / endpoint id */
  modelName: string;
  /** 上下文长度（K token），仅文本 */
  contextK?: number;
  /** 计费单位与单价（元） */
  unit: "k_token" | "image" | "video_second" | "k_char" | "render";
  unitPrice: number;
  /** 平台代付时扣多少积分 */
  credits: number;
  /** 需要的最低套餐等级，free < creator < studio < enterprise */
  requiresPlan: "free" | "creator" | "studio" | "enterprise";
  /** 能力标签，供路由按任务类型挑选 */
  capabilities: string[];
  /** 是否只允许 BYOK（平台不代付，例如高成本视频模型） */
  byokOnly?: boolean;
  /** 平台不可用时的降级目标 */
  fallback?: string;
  /** 一句话说明，展示给用户 */
  note: string;
}

export const PLAN_RANK: Record<string, number> = {
  free: 0,
  creator: 1,
  studio: 2,
  enterprise: 3,
};

export const MODEL_CATALOG: ModelSpec[] = [
  /* -------------------------------- 文本 -------------------------------- */
  {
    key: "deepseek-chat",
    provider: "deepseek",
    vendor: "DeepSeek",
    label: "DeepSeek V3",
    kind: "text",
    protocol: "openai-chat",
    path: "/chat/completions",
    modelName: "deepseek-chat",
    contextK: 64,
    unit: "k_token",
    unitPrice: 0.002,
    credits: 1,
    requiresPlan: "creator",
    capabilities: ["copy", "fast", "json"],
    fallback: "doubao-pro-32k",
    note: "中文文案主力，结构化 JSON 稳定，成本低",
  },
  {
    key: "deepseek-reasoner",
    provider: "deepseek",
    vendor: "DeepSeek",
    label: "DeepSeek R1",
    kind: "text",
    protocol: "openai-chat",
    path: "/chat/completions",
    modelName: "deepseek-reasoner",
    contextK: 64,
    unit: "k_token",
    unitPrice: 0.004,
    credits: 2,
    requiresPlan: "studio",
    capabilities: ["copy", "reasoning", "json"],
    fallback: "deepseek-chat",
    note: "适合选题拆解、竞品反推这类需要推理的任务",
  },
  {
    key: "doubao-pro-32k",
    provider: "doubao",
    vendor: "豆包 · 火山方舟",
    label: "豆包 Pro 32K",
    kind: "text",
    protocol: "openai-chat",
    path: "/chat/completions",
    modelName: "doubao-pro-32k",
    contextK: 32,
    unit: "k_token",
    unitPrice: 0.0015,
    credits: 1,
    requiresPlan: "creator",
    capabilities: ["copy", "json"],
    fallback: "local-text",
    note: "国内直连延迟低，作为 DeepSeek 的备份通道",
  },
  {
    key: "local-text",
    provider: "local",
    vendor: "内置",
    label: "本地规则引擎",
    kind: "text",
    protocol: "local",
    path: "",
    modelName: "local-rules",
    unit: "k_token",
    unitPrice: 0,
    credits: 0,
    requiresPlan: "free",
    capabilities: ["copy", "json", "offline"],
    note: "零密钥可用，输出确定性结构，用于演示与兜底",
  },

  /* -------------------------------- 图像 -------------------------------- */
  {
    key: "doubao-image-2.5",
    provider: "doubao",
    vendor: "豆包 · 火山方舟",
    label: "Image 2.5",
    kind: "image",
    protocol: "ark-image",
    path: "/images/generations",
    modelName: "doubao-seedream-2-5",
    unit: "image",
    unitPrice: 0.25,
    credits: 6,
    requiresPlan: "creator",
    capabilities: ["poster", "illustration"],
    note: "中文文字渲染好，适合海报与封面底图",
  },
  {
    key: "local-render",
    provider: "local",
    vendor: "内置",
    label: "本地排版渲染",
    kind: "image",
    protocol: "local",
    path: "",
    modelName: "local-renderer",
    unit: "render",
    unitPrice: 0.02,
    credits: 3,
    requiresPlan: "free",
    capabilities: ["poster", "cover", "offline"],
    note: "SVG + 真实字体排版，文字不会糊，零外部依赖",
  },

  /* -------------------------------- 视频 -------------------------------- */
  {
    key: "doubao-seedance-2.5",
    provider: "doubao",
    vendor: "豆包 · 火山方舟",
    label: "Seedance 2.5",
    kind: "video",
    protocol: "ark-video",
    path: "/contents/generations/tasks",
    modelName: "doubao-seedance-2-5",
    unit: "video_second",
    unitPrice: 0.12,
    credits: 12,
    requiresPlan: "studio",
    capabilities: ["text2video", "img2video"],
    byokOnly: true,
    note: "按秒计费、成本高，默认要求自带 Key，避免误点烧钱",
  },
  {
    key: "local-storyboard",
    provider: "local",
    vendor: "内置",
    label: "本地分镜渲染",
    kind: "video",
    protocol: "local",
    path: "",
    modelName: "local-storyboard",
    unit: "render",
    unitPrice: 0.01,
    credits: 4,
    requiresPlan: "free",
    capabilities: ["storyboard", "offline"],
    note: "关键帧 + 时间轴 + 字幕轨，可播放预览，零外部依赖",
  },

  /* -------------------------------- 语音 -------------------------------- */
  {
    key: "doubao-tts",
    provider: "doubao",
    vendor: "豆包 · 火山方舟",
    label: "语音合成 2.0",
    kind: "audio",
    protocol: "ark-tts",
    path: "/audio/speech",
    modelName: "doubao-tts",
    unit: "k_char",
    unitPrice: 0.03,
    credits: 2,
    requiresPlan: "creator",
    capabilities: ["tts", "narration"],
    note: "中文多音色，支持语速与情绪参数",
  },
  {
    key: "local-tts",
    provider: "local",
    vendor: "内置",
    label: "本地音轨合成",
    kind: "audio",
    protocol: "local",
    path: "",
    modelName: "local-synth",
    unit: "render",
    unitPrice: 0.01,
    credits: 2,
    requiresPlan: "free",
    capabilities: ["tts", "offline"],
    note: "按文案生成节拍音轨与字幕时间轴，用于演示",
  },
];

export const modelByKey = (key: string): ModelSpec | undefined =>
  MODEL_CATALOG.find((m) => m.key === key);

export const modelsOfKind = (kind: ModelKind): ModelSpec[] =>
  MODEL_CATALOG.filter((m) => m.kind === kind);

/** 套餐是否覆盖该模型 */
export function planAllows(spec: ModelSpec, planCode: string | null | undefined): boolean {
  const have = PLAN_RANK[planCode ?? "free"] ?? 0;
  return have >= (PLAN_RANK[spec.requiresPlan] ?? 0);
}
