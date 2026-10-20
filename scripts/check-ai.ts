/**
 * 模型连通性自检：npm run check:ai
 *
 * 跑三件事，任何一步失败就带上「具体是哪个环节、下一步做什么」退出码 1：
 *   1. Key 能不能过鉴权（GET /models）
 *   2. 目录里写的模型名在账号里存不存在（对 /models 名单）
 *   3. 真发一次 JSON 模式请求（业务真正用的形态），报耗时 / token / 成本
 *
 * 为什么值得单独做个脚本：模型名写错时供应商返回 400 而不是 404，
 * 现象和「Key 过期」几乎一样，人在界面上只能看到「调用失败」。
 * 这个脚本把两者拆开：能列出模型 = Key 好的；列不出配置的那个 = 名字错了。
 *
 * 跑之前确认 .env 里 DEEPSEEK_API_KEY 已填。
 */
import "dotenv/config";
import { env } from "@/lib/env";
import { MODEL_CATALOG } from "@/lib/ai/catalog";
import { modelNameOf } from "@/lib/ai/model-name";
import { chatCompletion } from "@/lib/ai/adapters";
import { ProviderError } from "@/lib/gateway/types";

const g = "\x1b[32m";
const r = "\x1b[31m";
const y = "\x1b[33m";
const d = "\x1b[2m";
const x = "\x1b[0m";

const ok = (label: string, detail: string) =>
  console.log(`${g}OK ${x} ${label.padEnd(26)} ${d}${detail}${x}`);
const bad = (label: string, detail: string) =>
  console.log(`${r}NG ${x} ${label.padEnd(26)} ${detail}`);
const warn = (label: string, detail: string) =>
  console.log(`${y}!  ${x} ${label.padEnd(26)} ${detail}`);

const mask = (k: string) =>
  k.length <= 8 ? "••••（长度异常）" : `${k.slice(0, 4)}••••${k.slice(-4)}`;

interface ModelsResp {
  data?: Array<{ id?: string; name?: string; context_window?: number }>;
  error?: { message?: string; type?: string };
}

async function main() {
  console.log(`\n${y}来客啦 · 模型连通性自检${x}\n`);

  const ds = env.providers.deepseek;
  console.log(`${d}baseUrl${x}  ${ds.baseUrl}`);
  console.log(`${d}model  ${x}  ${ds.model}  ${d}(.env DEEPSEEK_MODEL)${x}`);
  console.log(`${d}apiKey ${x}  ${ds.apiKey ? mask(ds.apiKey) : "(未配置)"}\n`);

  let failed = false;

  if (!ds.apiKey) {
    bad("平台 Key", "DEEPSEEK_API_KEY 为空：文案任务会静默走本地规则引擎。在 .env 填入后重启进程。");
    console.log(`\n${r}未配置 Key，跳过连通性测试${x}\n`);
    process.exit(1);
  }

  /* ---------------- 1. 鉴权 + 拉模型名单 ---------------- */
  const url = `${ds.baseUrl.replace(/\/$/, "")}/models`;
  const started = Date.now();
  let list: string[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${ds.apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: ModelsResp = {};
    try {
      json = JSON.parse(text) as ModelsResp;
    } catch {
      /* 非 JSON，下面用 text 报错 */
    }
    if (!res.ok) {
      failed = true;
      if (res.status === 401 || res.status === 403) {
        bad("鉴权 /models", `HTTP ${res.status}：Key 无效或已过期。到 platform.deepseek.com 重新生成，写进 .env 后重启。`);
      } else if (res.status === 429) {
        bad("鉴权 /models", `HTTP 429：限流，稍后重试。`);
      } else if (res.status >= 500) {
        bad("鉴权 /models", `HTTP ${res.status}：供应商服务端异常，稍后重试。上游：${json.error?.message ?? text.slice(0, 120)}`);
      } else {
        bad("鉴权 /models", `HTTP ${res.status}：${json.error?.message ?? text.slice(0, 160)}`);
      }
    } else {
      list = (json.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
      ok(
        "鉴权 /models",
        `${list.length} 个模型可用 · ${Date.now() - started}ms · ${list.join("、") || "(空)"}`,
      );
    }
  } catch (err) {
    failed = true;
    const e = err as Error;
    if (e.name === "AbortError") bad("鉴权 /models", `20 秒超时（${url}）：检查本机出网 / 代理。`);
    else bad("鉴权 /models", `网络不可达：${e.message}（${url}）`);
  }

  /* ---------------- 2. 目录模型名 vs 账号实际名单 ---------------- */
  const dsSpecs = MODEL_CATALOG.filter((m) => m.provider === "deepseek");
  if (list.length > 0) {
    for (const spec of dsSpecs) {
      const name = modelNameOf(spec);
      if (list.includes(name)) {
        ok(`目录 ${spec.key}`, `modelName=${name} 存在`);
      } else {
        failed = true;
        bad(
          `目录 ${spec.key}`,
          `modelName=${name} 不在账号模型列表里 → 调用会 400 model_not_found。` +
            `改用：${list.join(" / ")}，并同步 .env 的 DEEPSEEK_MODEL。`,
        );
      }
    }
  } else {
    warn("目录模型名", "鉴权失败或名单为空，跳过比对");
  }

  /* ---------------- 3. 真发一次 JSON 请求 ---------------- */
  const spec = dsSpecs.find((m) => m.key === "deepseek-chat");
  if (spec && !failed) {
    const t0 = Date.now();
    try {
      const res = await chatCompletion({
        baseUrl: ds.baseUrl,
        apiKey: ds.apiKey,
        model: modelNameOf(spec),
        label: `${spec.vendor} · ${spec.label}`,
        priceIn: spec.unitPrice,
        priceOut: spec.unitPrice * 2,
        system: "你是接口连通性测试助手，只输出 JSON，不要任何解释文字。",
        user: '请输出 {"ok":true,"who":"laikela"}',
        json: true,
        temperature: 0,
        maxTokens: 80,
        timeoutMs: 45_000,
      });
      ok(
        "chat/completions",
        `${modelNameOf(spec)} · ${Date.now() - t0}ms · in ${res.usage.inputTokens} / out ${res.usage.outputTokens} tok · ¥${res.usage.costCny.toFixed(6)}`,
      );
      console.log(`${d}  返回：${res.text.replace(/\s+/g, " ").slice(0, 160)}${x}`);
    } catch (err) {
      failed = true;
      const e = err as ProviderError;
      bad("chat/completions", `${e.code ?? "UNKNOWN"} · ${e.message}`);
      if (e.code === "MODEL_NOT_FOUND") {
        console.log(`${d}  提示：改 .env 的 DEEPSEEK_MODEL，或改 catalog 的 modelName；不要改 Key。${x}`);
      } else if (e.code === "AUTH") {
        console.log(`${d}  提示：Key 本身有问题。/models 能通但这里 401，多为代理商 Key 未开通 chat 权限。${x}`);
      } else if (e.code === "QUOTA") {
        console.log(`${d}  提示：账户余额不足，充值后重试。${x}`);
      }
    }
  } else if (!spec) {
    warn("chat/completions", "目录里没有 deepseek-chat 这个文本模型，跳过");
  } else {
    warn("chat/completions", "前置检查未通过，跳过实调用（先修上面的问题）");
  }

  console.log(
    failed
      ? `\n${r}模型链路未就绪${x} ${d}——修完上面的问题重跑 npm run check:ai${x}\n`
      : `\n${g}模型链路就绪${x} ${d}——文案任务会走真实模型${x}\n`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`${r}自检脚本异常：${x}`, e);
  process.exit(1);
});
