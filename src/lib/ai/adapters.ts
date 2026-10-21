/**
 * 协议适配器。同一个接口契约下，把不同厂商的 HTTP 形态抹平：
 *
 *   openai-chat  → POST /chat/completions（DeepSeek、豆包文本都兼容）
 *   ark-image    → POST /images/generations（Image 2.5）
 *   ark-video    → POST /contents/generations/tasks + 轮询（Seedance 2.5）
 *   ark-tts      → POST /audio/speech（语音合成 2.0）
 *
 * 每个函数都显式接收 apiKey / baseUrl，不吃全局状态 —— 这是支持
 * 「同一进程内平台 Key 与租户 BYOK 并存」的前提。
 */
import { ProviderError, type TextRequest, type TextResult } from "@/lib/gateway/types";
import { env } from "@/lib/env";

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const join = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 报错时用来定位「是哪个供应商的哪个模型出的问题」 */
interface CallContext {
  label: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** 上游错误的可读描述。DeepSeek / 豆包都是 { error: { message, type, code } } */
interface UpstreamDetail {
  message: string;
  type?: string;
  code?: string;
}

function detailOf(json: unknown, text: string): UpstreamDetail {
  if (json && typeof json === "object") {
    const err = (json as { error?: unknown }).error;
    if (err && typeof err === "object") {
      const e = err as { message?: string; type?: string; code?: string | number };
      return {
        message: String(e.message ?? "").trim(),
        type: e.type ? String(e.type) : undefined,
        code: e.code === undefined ? undefined : String(e.code),
      };
    }
    if (typeof err === "string") return { message: err };
    const msg = (json as { message?: string }).message;
    if (msg) return { message: String(msg) };
  }
  return { message: text.replace(/\s+/g, " ").trim() };
}

/**
 * 把 HTTP 状态码翻译成「用户看得懂、且知道下一步干什么」的错误。
 *
 * 关键点：**不能只看状态码**。模型名写错时，DeepSeek 给 400 而不是 404，
 * 混在「请求失败」里和「Key 不对」长得一模一样，用户会去反复换 Key。
 * 所以这里额外看上游 message 的语义，并且每条消息都带上 model 名与 Key 尾号。
 */
function fail(status: number, ctx: CallContext, json: unknown, text: string): ProviderError {
  const d = detailOf(json, text);
  const tail = ctx.apiKey && ctx.apiKey.length >= 4 ? ctx.apiKey.slice(-4) : "";
  const head = `${ctx.label}（model=${ctx.model}）返回 ${status}`;
  const up = d.message ? `上游说明：${clip(d.message, 180)}` : "上游未返回错误说明";
  const raw = `${head}。${up}`;

  const msg = d.message;
  // 模型名写错时上游措辞五花八门：
  //   "Model Not Exist"、"invalid model"、"The supported API model names are a, b, but you passed c"
  // 共同点是都提到 model、并且要么带否定词、要么把我们传的名字回显出来。
  const modelRejected = /(not\s*(exist|found|supported|available)|does\s+not\s+exist|invalid|unknown|unsupported|no\s+such|supported\s+(api\s+)?model|不存在|无效|不支持)/i;
  const isModelIssue =
    (/\bmodel\b/i.test(msg) || msg.includes(ctx.model)) &&
    (modelRejected.test(msg) || msg.includes(ctx.model));

  if (status === 404 || isModelIssue) {
    return new ProviderError(
      "MODEL_NOT_FOUND",
      `${raw}。模型名「${ctx.model}」不被该供应商识别：请核对 .env 的 DEEPSEEK_MODEL 是否为 GET /models 里的 id（当前可选 deepseek-flash、deepseek-v4-pro），改完重启进程，再跑 npm run check:ai 验证。`,
      false,
    );
  }
  if (status === 401 || status === 403) {
    return new ProviderError(
      "AUTH",
      `${raw}。API Key 无效、已过期或无权访问该模型${tail ? `（当前 Key 尾号 ${tail}）` : ""}：请核对 .env 的 DEEPSEEK_API_KEY，或到「设置 → 模型」换成你自己的 Key。`,
      false,
    );
  }
  if (status === 402 || /(insufficient|balance|quota|欠费|余额)/i.test(msg)) {
    return new ProviderError("QUOTA", `${raw}。账户余额不足或已欠费，请到供应商控制台充值后重试。`, false);
  }
  if (status === 429) {
    return new ProviderError("RATE_LIMIT", `${raw}。触发供应商限流：降低并发，或稍后重试。`, true);
  }
  if (status === 413 || /(context length|too long|maximum context)/i.test(msg)) {
    return new ProviderError("CONTEXT_TOO_LONG", `${raw}。输入超出该模型的上下文窗口，请精简输入。`, false);
  }
  if (status >= 500) {
    return new ProviderError("UPSTREAM", `${raw}。供应商服务端异常，稍后重试；持续失败请换模型。`, true);
  }
  if (/response_format|json_object/i.test(msg)) {
    return new ProviderError(
      "NO_JSON_MODE",
      `${raw}。该模型不支持 JSON 模式，请换用支持 json 的模型（如 deepseek-flash）。`,
      false,
    );
  }
  return new ProviderError("BAD_REQUEST", `${raw}。请求参数被拒，请检查模型名、参数与输入长度。`, false);
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  ctx: CallContext,
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      // 用户主动取消不算失败，原样抛出，由上层判定 canceled
      if (signal?.aborted) throw err;
      if (e.name === "AbortError") {
        throw new ProviderError(
          "TIMEOUT",
          `${ctx.label}（model=${ctx.model}）请求超时：${Math.round(timeoutMs / 1000)} 秒内没有响应（${url}）。可稍后重试，或检查网络/代理是否能访问该供应商。`,
          true,
        );
      }
      throw new ProviderError(
        "NETWORK",
        `${ctx.label}（model=${ctx.model}）网络不可达：${e.message || "连接失败"}（${url}）。请检查本机出网、代理与 DNS。`,
        true,
      );
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON 响应，保留原文用于报错 */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}


/* ------------------------------ 文本 ------------------------------ */

export async function chatCompletion(
  opts: CallOptions & TextRequest & { label: string; priceIn: number; priceOut: number },
): Promise<TextResult> {
  const started = Date.now();
  const maxTokens = opts.maxTokens ?? env.ai.maxOutputTokens;
  const ctx: CallContext = {
    label: opts.label,
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  };
  const { status, json, text } = await postJson(
    join(opts.baseUrl, "/chat/completions"),
    opts.apiKey,
    {
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: maxTokens,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    },
    opts.timeoutMs ?? 45_000,
    opts.signal,
    ctx,
  );

  if (status < 200 || status >= 300) throw fail(status, ctx, json, text);

  const data = json as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  /**
   * finish_reason=length 表示「写满了 max_tokens 被掐断」。
   *
   * 正文为空好判断；**正文非空也不能当成成功** —— 截断发生在 JSON 中间时，
   * 拿到的是一段能看见、但解析不了的内容，旧代码会把它报成
   * 「返回内容不是预期的 JSON 结构」，让用户以为是模型不听话。
   * 这里如实把 finishReason 透传出去，由上层先尝试解析、失败再按截断报错。
   */
  const finishReason = choice?.finish_reason;
  if (!content.trim()) {
    // 三种「看起来成功、其实没交付」的情况要分清，否则用户只看到「返回空内容」无从下手
    const reasoning = choice?.message?.reasoning_content ?? "";
    if (finishReason === "length") {
      throw new ProviderError(
        "TRUNCATED",
        `${opts.label}（model=${opts.model}）输出被截断：max_tokens=${maxTokens} 用尽时只产出了推理过程（${reasoning.length} 字），没有正文。请调大 max_tokens（推理型模型建议 ≥ 1500）后重试。`,
        true,
      );
    }
    if (reasoning) {
      throw new ProviderError(
        "EMPTY",
        `${opts.label}（model=${opts.model}）只返回了推理过程（${reasoning.length} 字），正文为空。可能是提示词要求过于宽泛或被安全策略拦截，可换模型或收紧输入后重试。`,
        true,
      );
    }
    throw new ProviderError(
      "EMPTY",
      `${opts.label}（model=${opts.model}）返回空内容（HTTP ${status}，choices=${data.choices?.length ?? 0}）。请重试；持续发生请更换模型。`,
      true,
    );
  }

  const inTok = data.usage?.prompt_tokens ?? Math.ceil((opts.system.length + opts.user.length) / 2);
  const outTok = data.usage?.completion_tokens ?? Math.ceil(content.length / 2);
  return {
    text: content,
    provider: opts.label,
    model: opts.model,
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      costCny: (inTok / 1000) * opts.priceIn + (outTok / 1000) * opts.priceOut,
    },
    latencyMs: Date.now() - started,
    local: false,
    finishReason,
    maxTokens,
  };
}

/* ------------------------------ 图像 ------------------------------ */

export interface ImageResult {
  /** data URL 或远程 URL；接入方负责下载并转存 */
  images: Array<{ url?: string; b64?: string }>;
  width: number;
  height: number;
}

export async function generateImageArk(
  opts: CallOptions & { prompt: string; size?: string; n?: number },
): Promise<ImageResult> {
  const ctx: CallContext = { label: "Image 2.5", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const { status, json, text } = await postJson(
    join(opts.baseUrl, "/images/generations"),
    opts.apiKey,
    {
      model: opts.model,
      prompt: opts.prompt,
      size: opts.size ?? "1024x1024",
      n: opts.n ?? 1,
      response_format: "url",
    },
    opts.timeoutMs ?? 90_000,
    opts.signal,
    ctx,
  );
  if (status < 200 || status >= 300) throw fail(status, ctx, json, text);
  const data = json as { data?: Array<{ url?: string; b64_json?: string }> };
  const [w, h] = (opts.size ?? "1024x1024").split("x").map(Number);
  return {
    images: (data.data ?? []).map((d) => ({ url: d.url, b64: d.b64_json })),
    width: w || 1024,
    height: h || 1024,
  };
}

/* ------------------------------ 视频 ------------------------------ */

export async function createVideoTaskArk(
  opts: CallOptions & { prompt: string; ratio?: string; durationSec?: number },
): Promise<{ taskId: string; raw: unknown }> {
  const ctx: CallContext = { label: "Seedance 2.5", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const { status, json, text } = await postJson(
    join(opts.baseUrl, "/contents/generations/tasks"),
    opts.apiKey,
    {
      model: opts.model,
      content: [{ type: "text", text: opts.prompt }],
      ratio: opts.ratio ?? "9:16",
      duration: opts.durationSec ?? 5,
    },
    opts.timeoutMs ?? 30_000,
    opts.signal,
    ctx,
  );
  if (status < 200 || status >= 300) throw fail(status, ctx, json, text);
  const data = json as { id?: string };
  if (!data.id) {
    throw new ProviderError(
      "NO_TASK",
      `Seedance 2.5（model=${opts.model}）创建任务成功但未返回任务 id，无法轮询结果。响应：${clip(text, 200)}`,
      true,
    );
  }
  return { taskId: data.id, raw: json };
}

export async function fetchVideoTaskArk(
  opts: CallOptions & { taskId: string },
): Promise<{ status: string; videoUrl?: string }> {
  const ctx: CallContext = { label: "Seedance 2.5", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const res = await fetch(join(opts.baseUrl, `/contents/generations/tasks/${opts.taskId}`), {
    headers: { authorization: `Bearer ${opts.apiKey}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    content?: { video_url?: string };
  };
  if (!res.ok) throw fail(res.status, ctx, json, JSON.stringify(json));
  return { status: json.status ?? "unknown", videoUrl: json.content?.video_url };
}

/* ------------------------------ 视频（阿里百炼 Wan） ------------------------------ */

/**
 * compatible-mode 的 baseUrl 是 `{host}/compatible-mode/v1`，
 * 而百炼的视频异步任务只在**根路径**的 `/api/v1/...` 下提供 ——
 * 这两套路径不能拼在一起，必须先把 host 剥出来。
 */
const dashscopeHost = (baseUrl: string) =>
  baseUrl.replace(/\/compatible-mode\/v1\/?$/i, "").replace(/\/+$/, "");

/** 供应商只认像素尺寸，不认 9:16 这种比例字符串 */
const sizeOfRatio = (ratio?: string) => {
  if (ratio === "16:9") return "1280*720";
  if (ratio === "1:1") return "960*960";
  return "720*1280"; // 9:16，短视频默认竖屏
};

export async function createVideoTaskDashscope(
  opts: CallOptions & { prompt: string; ratio?: string; durationSec?: number },
): Promise<{ taskId: string; raw: unknown }> {
  const ctx: CallContext = { label: "Wan 3.0 Video", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const url = `${dashscopeHost(opts.baseUrl)}/api/v1/services/aigc/video-generation/video-synthesis`;
  const body = {
    model: opts.model,
    input: { prompt: opts.prompt },
    parameters: {
      size: sizeOfRatio(opts.ratio),
      duration: opts.durationSec ?? 5,
      prompt_extend: true,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          // 百炼的视频合成是异步任务，不带这个头会直接 400
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (opts.signal?.aborted) throw err;
      if (e.name === "AbortError") {
        throw new ProviderError(
          "TIMEOUT",
          `Wan 3.0 Video（model=${opts.model}）提交任务超时（${url}）`,
          true,
        );
      }
      throw new ProviderError("NETWORK", `Wan 3.0 Video 网络不可达：${e.message}（${url}）`, true);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    if (!res.ok) throw fail(res.status, ctx, json, text);
    const taskId = (json as { output?: { task_id?: string } })?.output?.task_id;
    if (!taskId) {
      throw new ProviderError(
        "NO_TASK",
        `Wan 3.0 Video（model=${opts.model}）提交成功但未返回 task_id。响应：${clip(text, 200)}`,
        true,
      );
    }
    return { taskId, raw: json };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchVideoTaskDashscope(
  opts: CallOptions & { taskId: string },
): Promise<{ status: string; videoUrl?: string }> {
  const ctx: CallContext = { label: "Wan 3.0 Video", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const url = `${dashscopeHost(opts.baseUrl)}/api/v1/tasks/${opts.taskId}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${opts.apiKey}` } });
  const json = (await res.json().catch(() => ({}))) as {
    output?: { task_status?: string; video_url?: string; message?: string };
  };
  if (!res.ok) throw fail(res.status, ctx, json, JSON.stringify(json));

  // 百炼状态是大写枚举，统一成 pipeline 认识的小写
  const map: Record<string, string> = {
    PENDING: "pending",
    RUNNING: "running",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
    CANCELED: "canceled",
    UNKNOWN: "failed",
  };
  const raw = json.output?.task_status ?? "UNKNOWN";
  return {
    status: map[raw] ?? raw.toLowerCase(),
    videoUrl: json.output?.video_url,
  };
}

/* ------------------------------ 语音 ------------------------------ */

export async function speechArk(
  opts: CallOptions & { text: string; voice?: string; speed?: number },
): Promise<{ audio: Buffer; mime: string; durationMs: number }> {
  const ctx: CallContext = { label: "语音合成", model: opts.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl };
  const { status, text: raw, json } = await postJson(
    join(opts.baseUrl, "/audio/speech"),
    opts.apiKey,
    {
      model: opts.model,
      input: opts.text,
      voice: opts.voice ?? "zh_female_qingxin",
      speed: opts.speed ?? 1,
      response_format: "wav",
    },
    opts.timeoutMs ?? 60_000,
    opts.signal,
    ctx,
  );
  if (status < 200 || status >= 300) {
    throw fail(status, ctx, json, typeof json === "string" ? json : raw);
  }
  // 部分网关返回 JSON + base64，部分直接返回二进制；这里两种都接
  const maybe = json as { audio?: string } | null;
  const audio = maybe?.audio ? Buffer.from(maybe.audio, "base64") : Buffer.from(raw, "binary");
  return {
    audio,
    mime: "audio/wav",
    durationMs: Math.round((opts.text.length / 4.2) * 1000),
  };
}
