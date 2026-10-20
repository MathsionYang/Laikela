import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { chatCompletion } from "@/lib/ai/adapters";
import { normalizeBaseUrl, resolveEndpoint } from "@/lib/ai/custom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 测试连接：真的发一次最小的 /chat/completions，而不是只校验 URL 格式。
 *
 * 两种用法：
 *  - 已保存的端点：{ id }         —— 用库里的 Key 测（改了 Key 想复测就走这个）
 *  - 保存前试一下：{ baseUrl, modelName, apiKey }
 *
 * 为什么必须有这个按钮：OpenAI 兼容层的坑几乎都在「baseUrl 该不该带 /v1」
 * 和「模型名对不对」，这两类错误只有真打一次才能暴露。
 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await readJson<{
    id?: string;
    baseUrl?: string;
    modelName?: string;
    apiKey?: string;
  }>(req);

  let baseUrl = "";
  let modelName = "";
  let apiKey = "";

  if (body.id) {
    const ep = await resolveEndpoint(session.orgId, body.id);
    if (!ep) return fail("ENDPOINT_NOT_FOUND", "端点不存在或凭证无法解密", 404);
    baseUrl = ep.baseUrl;
    modelName = ep.row.model_name;
    apiKey = ep.apiKey;
  } else {
    baseUrl = normalizeBaseUrl(body.baseUrl ?? "");
    modelName = (body.modelName ?? "").trim();
    apiKey = (body.apiKey ?? "").trim();
  }

  if (!baseUrl || !modelName || !apiKey) {
    return fail("BAD_REQUEST", "请填写 Base URL、模型名称与 Key", 422);
  }

  const started = Date.now();
  try {
    const res = await chatCompletion({
      baseUrl,
      apiKey,
      model: modelName,
      label: modelName,
      priceIn: 0,
      priceOut: 0,
      system: "你是连通性测试助手。",
      user: "只回复两个字：可用",
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 20_000,
    });
    return ok({
      ok: true,
      latencyMs: Date.now() - started,
      sample: res.text.slice(0, 60),
      endpoint: `${baseUrl}/chat/completions`,
      model: modelName,
    });
  } catch (err) {
    return ok(
      {
        ok: false,
        latencyMs: Date.now() - started,
        endpoint: `${baseUrl}/chat/completions`,
        model: modelName,
        error: (err as Error).message,
        /** 常见错的排查提示，直接给到用户 */
        hint: /404|405/.test((err as Error).message)
          ? "路径没命中：多数兼容服务需要 baseUrl 以 /v1 结尾，例如 https://api.xxx.com/v1"
          : /401|403/.test((err as Error).message)
            ? "鉴权失败：检查 Key 是否完整、是否有多余空格、是否已过期"
            : /model/i.test((err as Error).message)
              ? "模型名不被识别：确认服务端实际的 model id（不是展示名）"
              : null,
      },
      { status: 200 },
    );
  }
}
