import { env } from "@/lib/env";
import { ProviderError, type ProviderAdapter, type TextRequest, type TextResult } from "./types";

interface CompatOptions {
  id: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 元/百万 token */
  priceIn: number;
  priceOut: number;
  timeoutMs?: number;
}

/**
 * OpenAI 兼容的 Chat Completions 适配器。
 * DeepSeek 与豆包（火山方舟）都是同一套 /chat/completions 形态，
 * 因此共用一个实现，只有 baseUrl / model / 价格不同。
 */
export function openAiCompat(opts: CompatOptions): ProviderAdapter {
  return {
    id: opts.id,
    label: opts.label,
    available: Boolean(opts.apiKey),
    async generateText(req: TextRequest): Promise<TextResult> {
      if (!opts.apiKey) {
        throw new ProviderError("NO_KEY", `${opts.label} 未配置密钥`, false);
      }
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
      req.signal?.addEventListener("abort", () => controller.abort(), { once: true });

      try {
        const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? env.ai.maxOutputTokens,
            ...(req.json ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            throw new ProviderError("AUTH", `${opts.label} 鉴权失败（${res.status}）`, false);
          }
          if (res.status === 429) {
            throw new ProviderError("RATE_LIMIT", `${opts.label} 触发限流（429）`, true);
          }
          if (res.status >= 500) {
            throw new ProviderError("UPSTREAM", `${opts.label} 服务异常（${res.status}）`, true);
          }
          throw new ProviderError(
            "BAD_REQUEST",
            `${opts.label} 拒绝请求（${res.status}）：${body.slice(0, 200)}`,
            false,
          );
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text.trim()) {
          throw new ProviderError("EMPTY", `${opts.label} 返回空内容`, true);
        }
        const inTok = data.usage?.prompt_tokens ?? 0;
        const outTok = data.usage?.completion_tokens ?? 0;
        return {
          text,
          provider: opts.id,
          model: opts.model,
          usage: {
            inputTokens: inTok,
            outputTokens: outTok,
            costCny: Number(((inTok * opts.priceIn + outTok * opts.priceOut) / 1_000_000).toFixed(4)),
          },
          latencyMs: Date.now() - started,
          local: false,
        };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if ((err as Error).name === "AbortError") {
          throw new ProviderError("TIMEOUT", `${opts.label} 超时未返回`, true);
        }
        throw new ProviderError("NETWORK", `${opts.label} 网络错误：${(err as Error).message}`, true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
