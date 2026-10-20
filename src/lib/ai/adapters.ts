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

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const join = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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

const statusError = (status: number, label: string, text: string) => {
  if (status === 401 || status === 403) {
    return new ProviderError("AUTH", `${label} 鉴权失败（${status}），请检查 API Key`, false);
  }
  if (status === 429) return new ProviderError("RATE_LIMIT", `${label} 触发限流（429）`, true);
  if (status >= 500) return new ProviderError("UPSTREAM", `${label} 服务端错误（${status}）`, true);
  return new ProviderError("BAD_REQUEST", `${label} 请求失败（${status}）：${text.slice(0, 200)}`, false);
};

/* ------------------------------ 文本 ------------------------------ */

export async function chatCompletion(
  opts: CallOptions & TextRequest & { label: string; priceIn: number; priceOut: number },
): Promise<TextResult> {
  const started = Date.now();
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
      max_tokens: opts.maxTokens ?? 2200,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    },
    opts.timeoutMs ?? 45_000,
    opts.signal,
  );

  if (status < 200 || status >= 300) throw statusError(status, opts.label, text);

  const data = json as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new ProviderError("EMPTY", `${opts.label} 返回空内容`, true);

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
  );
  if (status < 200 || status >= 300) throw statusError(status, "Image 2.5", text);
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
  );
  if (status < 200 || status >= 300) throw statusError(status, "Seedance 2.5", text);
  const data = json as { id?: string };
  if (!data.id) throw new ProviderError("NO_TASK", "Seedance 未返回任务 id", true);
  return { taskId: data.id, raw: json };
}

export async function fetchVideoTaskArk(
  opts: CallOptions & { taskId: string },
): Promise<{ status: string; videoUrl?: string }> {
  const res = await fetch(join(opts.baseUrl, `/contents/generations/tasks/${opts.taskId}`), {
    headers: { authorization: `Bearer ${opts.apiKey}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    content?: { video_url?: string };
  };
  if (!res.ok) throw statusError(res.status, "Seedance 2.5", JSON.stringify(json));
  return { status: json.status ?? "unknown", videoUrl: json.content?.video_url };
}

/* ------------------------------ 语音 ------------------------------ */

export async function speechArk(
  opts: CallOptions & { text: string; voice?: string; speed?: number },
): Promise<{ audio: Buffer; mime: string; durationMs: number }> {
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
  );
  if (status < 200 || status >= 300) {
    throw statusError(status, "语音合成", typeof json === "string" ? json : raw);
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
