import { blocksToHtml } from "@/lib/domain/blocks";
import { PROMPT_VERSION } from "@/lib/domain/prompts";
import { getTool, type ToolDef } from "@/lib/domain/tools";
import { generateCopy } from "@/lib/gateway";
import { ProviderError } from "@/lib/gateway/types";
import { newId } from "@/lib/db";
import { synthAudio } from "@/lib/media/audio";
import {
  artSvg,
  coverSvg,
  normalizeKeyframe,
  posterSvg,
  probeImage,
  rasterize,
  thumbnail,
} from "@/lib/media/image";
import { buildShots, renderShot, type Timeline } from "@/lib/media/video";
import { storage } from "@/lib/storage";
import { moderate } from "@/lib/moderation";
import { refund } from "@/lib/credits";
import { planCodeOf } from "@/lib/billing";
import { resolveModel, type ResolvedModel } from "@/lib/ai/router";
import { speechArk, generateImageArk, createVideoTaskArk, fetchVideoTaskArk } from "@/lib/ai/adapters";
import type { ModelKind } from "@/lib/ai/catalog";
import { q, q1 } from "@/lib/db";
import {
  addAsset,
  addModeration,
  addUsage,
  assetUrl,
  audit,
  isCanceled,
  updateJob,
  type AssetRow,
  type JobRow,
} from "./repo";

const PALETTE: Record<string, string> = {
  墨金: "#D8A85E",
  朱红: "#C0504A",
  松绿: "#5C8A6E",
  墨蓝: "#3C5A7D",
  米白: "#EDE4D3",
};

const countOf = (v: unknown, fallback = 1) => {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9) : fallback;
};

function sizeFor(tool: ToolDef, v: unknown): { width: number; height: number } {
  const s = String(v ?? "");
  const dims = s.match(/(\d{3,4})\s*[×x]\s*(\d{3,4})/);
  if (dims) return { width: Number(dims[1]), height: Number(dims[2]) };
  if (s.startsWith("1:1")) return { width: 1024, height: 1024 };
  if (s.startsWith("3:4")) return { width: 1080, height: 1440 };
  if (s.startsWith("9:16")) return { width: 1080, height: 1920 };
  if (s.startsWith("16:9")) return { width: 1920, height: 1080 };
  return tool.slug === "image-gen" ? { width: 1024, height: 1024 } : { width: 1080, height: 1440 };
}

async function put(
  orgId: string,
  jobId: string,
  key: string,
  body: Buffer,
  mime: string,
): Promise<string> {
  const full = `${orgId}/jobs/${jobId}/${key}`;
  await storage().put(full, body, mime);
  return full;
}

function publicAsset(a: AssetRow) {
  return {
    id: a.id,
    role: a.role,
    kind: a.kind,
    name: a.name,
    mime: a.mime,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    durationMs: a.duration_ms,
    url: assetUrl(a),
    meta: a.meta,
  };
}

const stage = (jobId: string, pct: number, text: string) =>
  updateJob(jobId, { progress: pct, stage: text });

/* ---------------------------- 模型路由（任务内） ---------------------------- */

const MODEL_KIND: Record<string, ModelKind> = {
  copy: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

/**
 * 解析本任务该用哪个模型。
 * 创建任务时已经把路由结果写进 job.model_key，这里以它为首选再解析一次 ——
 * 因为排队期间套餐可能到期、Key 可能被删，执行时必须重新校验。
 * 解析失败返回 null，调用方一律回落到本地引擎，保证任务不会因为配置问题跑不出来。
 */
async function modelFor(
  job: JobRow,
  kind: ModelKind,
  capability?: string,
): Promise<ResolvedModel | null> {
  try {
    const planCode = await planCodeOf(job.org_id);
    return await resolveModel({
      orgId: job.org_id,
      kind,
      planCode,
      preferredKey: job.model_key ?? undefined,
      capability,
    });
  } catch {
    return null;
  }
}

/** 是否真的要打外部接口（本地模型不走网络） */
const remoteOf = (r: ResolvedModel | null) => Boolean(r && r.spec.provider !== "local");

async function download(url: string, timeoutMs = 180_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载产物失败（${res.status}）`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 把路由结果记到任务上，谁付费、花了多少元，都留痕 */
async function markModel(job: JobRow, r: ResolvedModel, costCny: number) {
  await updateJob(job.id, {
    model_provider: r.spec.vendor,
    model_name: r.spec.key,
    prompt_version: PROMPT_VERSION,
    cost_cny: costCny.toFixed(4),
  });
  await addUsage({
    orgId: job.org_id,
    jobId: job.id,
    provider: r.spec.vendor,
    model: r.spec.key,
    unit: r.spec.unit,
    quantity: 1,
    unitPrice: r.spec.unitPrice,
    // BYOK 的真实成本由用户直接付给供应商，平台侧只记 0 元成本
    costCny: r.keySource === "byok" ? 0 : costCny,
  });
}

/**
 * 执行一个任务。由 worker 调用。
 * 状态机：running → post_processing → reviewing → succeeded
 */
export async function runJob(job: JobRow): Promise<void> {
  const tool = getTool(job.tool_slug);
  if (!tool) {
    await updateJob(job.id, {
      status: "failed",
      stage: "工具不存在",
      error_code: "NO_TOOL",
      error_message: `未注册的工具：${job.tool_slug}`,
      finished: true,
    });
    return;
  }

  if (await isCanceled(job.id)) return;

  await updateJob(job.id, { status: "running", stage: "解析输入", progress: 5, started: true });
  const input = (job.input ?? {}) as Record<string, unknown>;

  try {
    // 必填校验（前端也会校验，这里是服务端兜底）
    for (const f of tool.fields) {
      if (f.required && !String(input[f.id] ?? "").trim()) {
        throw new ProviderError("INVALID_INPUT", `缺少必填字段：${f.label}`, false);
      }
    }

    let output: Record<string, unknown>;

    if (tool.kind === "copy") {
      output = await runCopy(job, tool, input);
    } else if (tool.kind === "audio") {
      output = await runAudio(job, tool, input);
    } else if (tool.kind === "image") {
      output = await runImage(job, tool, input);
    } else {
      output = await runVideo(job, tool, input);
    }

    if (await isCanceled(job.id)) return;

    // ---- 内容审核 ----
    await updateJob(job.id, { status: "reviewing", stage: "内容审核", progress: 92 });
    const textToCheck = collectText(output);
    const verdict = moderate(textToCheck);
    await addModeration({
      orgId: job.org_id,
      jobId: job.id,
      target: "output",
      level: verdict.level,
      hits: verdict.hits,
      suggestion: verdict.suggestion,
    });

    const finalOutput = { ...output, moderation: verdict };
    await updateJob(job.id, {
      status: "succeeded",
      stage: verdict.level === "pass" ? "已完成" : "已完成（有审核提示）",
      progress: 100,
      output: finalOutput,
      finished: true,
    });

    await audit({
      orgId: job.org_id,
      action: "job.succeeded",
      target: job.id,
      detail: { tool: tool.slug, provider: job.model_provider, level: verdict.level },
    });
  } catch (err) {
    const e = err as ProviderError;
    const canceled = await isCanceled(job.id);
    if (canceled) return;
    await updateJob(job.id, {
      status: "failed",
      stage: "生成失败",
      error_code: e.code ?? "UNKNOWN",
      error_message: e.message ?? String(err),
      finished: true,
    });
    // 失败必退：用户不该为一次没跑出来的生成付积分
    const back = await refund({
      orgId: job.org_id,
      jobId: job.id,
      reason: "任务失败，自动退回积分",
    });
    await audit({
      orgId: job.org_id,
      action: "job.failed",
      target: job.id,
      detail: { tool: tool.slug, code: e.code ?? "UNKNOWN", message: e.message, refunded: back.credits },
    });
  }
}

function collectText(output: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(output);
  return parts.join("\n").slice(0, 20000);
}

/* ------------------------------- 文案 ------------------------------- */

async function runCopy(
  job: JobRow,
  tool: ToolDef,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await stage(job.id, 18, "加载提示词");
  const planCode = await planCodeOf(job.org_id);
  await stage(job.id, 30, "模型生成中");

  const res = await generateCopy(tool, input, {
    orgId: job.org_id,
    planCode,
    modelKey: job.model_key,
  });

  await stage(job.id, 78, "整理结构化结果");
  const html = blocksToHtml(res.blocks);
  const title = String(input.topic ?? input.product ?? input.account ?? input.keyword ?? tool.name);

  const docId = newId("doc");
  await q(
    `insert into copy_documents (id, org_id, job_id, tool_slug, title, structured, content_html)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      docId,
      job.org_id,
      job.id,
      tool.slug,
      title.slice(0, 80),
      JSON.stringify({ blocks: res.blocks, plain: res.plain }),
      html,
    ],
  );

  await updateJob(job.id, {
    model_provider: res.provider,
    model_name: res.modelKey,
    prompt_version: PROMPT_VERSION,
    attempts: res.attempts,
    cost_cny: res.usage.costCny.toFixed(4),
  });

  await addUsage({
    orgId: job.org_id,
    jobId: job.id,
    provider: res.provider,
    model: res.modelKey,
    unit: "k_token",
    quantity: Number(((res.usage.inputTokens + res.usage.outputTokens) / 1000).toFixed(3)),
    unitPrice: 1.5,
    // BYOK：成本在用户自己的账单上，平台侧按 0 记
    costCny: res.keySource === "byok" ? 0 : res.usage.costCny,
  });

  return {
    type: "copy",
    docId,
    blocks: res.blocks,
    html,
    plain: res.plain,
    provider: res.provider,
    model: res.model,
    modelKey: res.modelKey,
    keySource: res.keySource,
    /** 首选模型没跑通时，这里会写清楚降级原因，前端直接显示 */
    degraded: res.degraded,
    local: res.local,
    latencyMs: res.latencyMs,
    usage: res.usage,
  };
}

/* ------------------------------- 音频 ------------------------------- */

/** 界面上的音色名 → 供应商 voice id */
const VOICE_MAP: Record<string, string> = {
  "女声 · 温柔": "zh_female_qingxin",
  "女声 · 元气": "zh_female_wanwanxiaohe",
  "男声 · 沉稳": "zh_male_wennuanahu",
  "男声 · 磁性": "zh_male_jingqiangkanye",
};

async function runAudio(
  job: JobRow,
  _tool: ToolDef,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const script = String(input.script ?? "");
  const voice = String(input.voice ?? "女声 · 温柔");
  const speed = Number(input.speed ?? 1);
  const model = await modelFor(job, "audio", "tts");

  // ---- 云端语音合成（豆包语音 2.0）：失败即回落本地音轨 ----
  if (remoteOf(model) && model) {
    try {
      await stage(job.id, 28, `语音合成 · ${model.spec.label}`);
      const tts = await speechArk({
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.spec.modelName,
        text: script,
        voice: VOICE_MAP[voice] ?? "zh_female_qingxin",
        speed,
      });
      await stage(job.id, 70, "写入音轨");
      const key = await put(job.org_id, job.id, "mix.mp3", tts.audio, tts.mime);
      const asset = await addAsset({
        orgId: job.org_id,
        jobId: job.id,
        kind: "audio",
        role: "final",
        name: "合成音轨.wav",
        mime: tts.mime,
        body: tts.audio,
        storageKey: key,
        durationMs: tts.durationMs,
        meta: { voice, speed, modelKey: model.spec.key, keySource: model.keySource },
      });
      const cost = (script.length / 1000) * model.spec.unitPrice;
      await markModel(job, model, cost);
      return {
        type: "audio",
        asset: publicAsset(asset),
        durationMs: tts.durationMs,
        segments: [{ index: 1, text: script.slice(0, 120), startMs: 0, endMs: tts.durationMs }],
        model: { key: model.spec.key, label: model.spec.label, keySource: model.keySource },
        local: false,
        degraded: null,
      };
    } catch (err) {
      // 记账后继续走本地合成，不失败整个任务
      console.warn("[audio] 云端合成失败，回落本地：", (err as Error).message);
    }
  }

  await stage(job.id, 25, "切分文案");
  const result = synthAudio({
    text: script,
    speed,
    bgm: String(input.bgm ?? "轻快"),
    voice,
  });

  await stage(job.id, 62, "合成音轨");
  const key = await put(job.org_id, job.id, "mix.wav", result.buffer, "audio/wav");
  const asset = await addAsset({
    orgId: job.org_id,
    jobId: job.id,
    kind: "audio",
    role: "final",
    name: "合成音轨.wav",
    mime: "audio/wav",
    body: result.buffer,
    storageKey: key,
    durationMs: result.durationMs,
    meta: { segments: result.segments.length, bgm: input.bgm, speed },
  });

  await updateJob(job.id, {
    model_provider: "内置",
    model_name: "local-tts",
    prompt_version: PROMPT_VERSION,
    cost_cny: "0.0000",
  });

  await addUsage({
    orgId: job.org_id,
    jobId: job.id,
    provider: "内置",
    model: "local-tts",
    unit: "render",
    quantity: 1,
    unitPrice: 0.01,
    costCny: 0,
  });

  return {
    type: "audio",
    asset: publicAsset(asset),
    durationMs: result.durationMs,
    segments: result.segments,
    model: { key: "local-tts", label: "本地音轨合成", keySource: "platform" },
    local: true,
    degraded: remoteOf(model)
      ? "云端语音合成不可用（检查 Key 或网络），已用本地音轨合成"
      : null,
  };
}

/* ------------------------------- 图片 ------------------------------- */

/** 把工具输入拼成一句给图像模型的描述 */
function imagePrompt(tool: ToolDef, input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (tool.slug === "image-poster") {
    parts.push(`营销海报：${input.theme ?? ""}`);
    if (input.title) parts.push(`主标题「${input.title}」`);
    if (input.subtitle) parts.push(`副标题「${input.subtitle}」`);
    if (input.when) parts.push(`时间地点 ${input.when}`);
    parts.push("中文排版清晰，留出安全边距，商业海报质感");
  } else if (tool.slug === "growth-cover") {
    parts.push(`内容封面：${input.copy ?? ""}`);
    if (input.style) parts.push(`风格：${input.style}`);
  } else {
    parts.push(String(input.prompt ?? tool.name));
    if (input.style) parts.push(`风格：${input.style}`);
  }
  if (input.palette) parts.push(`主色调：${input.palette}`);
  return parts.filter(Boolean).join("｜");
}

async function runImage(
  job: JobRow,
  tool: ToolDef,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const size = sizeFor(tool, input.size ?? input.ratio);
  const accent = PALETTE[String(input.palette ?? "墨金")] ?? "#D8A85E";
  const count = tool.slug === "image-gen" ? countOf(input.count, 1) : countOf(input.count, 3);
  const model = await modelFor(job, "image", "poster");

  const finals: ReturnType<typeof publicAsset>[] = [];
  let remoteCount = 0;
  let remoteError: string | null = null;

  for (let i = 0; i < count; i++) {
    if (await isCanceled(job.id)) break;
    await stage(job.id, 20 + Math.round((60 * i) / count), `渲染第 ${i + 1} / ${count} 张`);

    let png: Buffer | null = null;
    let name = `${tool.name}-${i + 1}.png`;

    // ---- 1) 优先走云端图像模型 ----
    if (remoteOf(model) && model) {
      try {
        const r = await generateImageArk({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.spec.modelName,
          prompt: `${imagePrompt(tool, input)}${i > 0 ? `｜变体 ${i + 1}` : ""}`,
          size: `${size.width}x${size.height}`,
        });
        const first = r.images[0];
        const raw = first?.b64
          ? Buffer.from(first.b64, "base64")
          : first?.url
            ? await download(first.url)
            : null;
        if (raw) {
          // 统一转 PNG：缩略图与预览链路只认这一种
          png = await (await import("sharp")).default(raw).png().toBuffer();
          remoteCount++;
          name = `${model.spec.label}-${i + 1}.png`;
        }
      } catch (err) {
        remoteError = (err as Error).message;
        console.warn("[image] 云端出图失败，回落本地渲染：", remoteError);
      }
    }

    // ---- 2) 云端不可用 → 本地真实字体排版渲染 ----
    if (!png) {
      if (tool.slug === "image-poster") {
        const svg = posterSvg({
          theme: String(input.theme ?? ""),
          title: String(input.title ?? input.theme ?? ""),
          subtitle: String(input.subtitle ?? ""),
          when: String(input.when ?? ""),
          eyebrow: "CAMPAIGN",
          footer: "来客啦 · LAIKELA",
          brand: "LAIKELA",
          accent,
          size,
        });
        png = await rasterize(svg, size.width, size.height);
      } else if (tool.slug === "growth-cover") {
        // 有上传关键帧就压成底图，否则纯排版封面
        const keyframeId = String(input.media ?? "");
        let base: Buffer | null = null;
        if (keyframeId) {
          const row = await q1<AssetRow>(`select * from assets where id = $1`, [keyframeId]);
          if (row && row.mime.startsWith("image/")) {
            const raw = await storage().get(row.storage_key);
            base = await normalizeKeyframe(raw, size);
          }
        }
        const svg = coverSvg({
          copy: String(input.copy ?? ""),
          kicker: ["大字报", "真人情绪", "对比冲突", "极简留白"].includes(String(input.style))
            ? String(input.style)
            : "封面",
          accent,
          size,
        });
        const overlay = await rasterize(svg, size.width, size.height);
        png = base
          ? await (await import("sharp")).default(base).composite([{ input: overlay }]).png().toBuffer()
          : overlay;
        name = `封面候选-${i + 1}.png`;
      } else {
        const svg = artSvg(
          `${String(input.prompt ?? "")}${i > 0 ? ` · 变体 ${i + 1}` : ""}`,
          String(input.style ?? "极简平面"),
          size,
        );
        png = await rasterize(svg, size.width, size.height);
        name = `创意图-${i + 1}.png`;
      }
    }

    const key = await put(job.org_id, job.id, `final-${i + 1}.png`, png, "image/png");
    const asset = await addAsset({
      orgId: job.org_id,
      jobId: job.id,
      kind: "image",
      role: "final",
      name,
      mime: "image/png",
      body: png,
      storageKey: key,
      width: size.width,
      height: size.height,
      meta: { index: i, accent, style: input.style ?? null, modelKey: model?.spec.key ?? null },
    });

    // 缩略图（素材库与列表用）
    const thumb = await thumbnail(png);
    const thumbKey = await put(job.org_id, job.id, `thumb-${i + 1}.webp`, thumb, "image/webp");
    await addAsset({
      orgId: job.org_id,
      jobId: job.id,
      kind: "image",
      role: "thumbnail",
      name: `${name} · 缩略图`,
      mime: "image/webp",
      body: thumb,
      storageKey: thumbKey,
      meta: { of: asset.id },
    });

    finals.push(publicAsset(asset));
  }

  const usedRemote = remoteCount > 0 && model;
  if (usedRemote && model) {
    await markModel(job, model, remoteCount * model.spec.unitPrice);
  } else {
    await updateJob(job.id, {
      model_provider: "内置",
      model_name: "local-render",
      prompt_version: PROMPT_VERSION,
      cost_cny: (finals.length * 0.02).toFixed(4),
    });
    await addUsage({
      orgId: job.org_id,
      jobId: job.id,
      provider: "内置",
      model: "local-render",
      unit: "image",
      quantity: finals.length,
      unitPrice: 0.02,
      costCny: Number((finals.length * 0.02).toFixed(4)),
    });
  }

  return {
    type: "image",
    assets: finals,
    size,
    accent,
    model: {
      key: usedRemote && model ? model.spec.key : "local-render",
      label: usedRemote && model ? model.spec.label : "本地排版渲染",
      keySource: usedRemote && model ? model.keySource : "platform",
    },
    local: !usedRemote,
    degraded: remoteOf(model) && !usedRemote
      ? `云端出图不可用（${remoteError ?? "未返回图片"}），已用本地排版渲染`
      : null,
    note: usedRemote ? "文字为模型生成，请核对错别字与价格表述" : "文字由真实字体渲染，非模型生成",
  };
}

/* ------------------------------- 视频 ------------------------------- */

async function runVideo(
  job: JobRow,
  tool: ToolDef,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ratio = String(input.ratio ?? "9:16 竖屏");
  const durationSec =
    tool.slug === "video-movie"
      ? Number(String(input.duration ?? "30").replace(/[^\d]/g, "")) || 30
      : tool.slug === "avatar-talking"
        ? Math.max(15, Math.ceil(String(input.script ?? "").length / 5))
        : tool.slug === "video-store"
          ? 30
          : tool.slug === "avatar-net"
            ? 20
            : 25;

  const topic = String(
    input.shop ?? input.media ?? input.script ?? tool.name,
  ).slice(0, 28);
  const point = String(
    input.combo ?? input.opening ?? input.template ?? input.flower ?? "把该讲清的讲清楚",
  ).slice(0, 30);
  const cta =
    tool.slug === "video-store"
      ? "到店报暗号，套餐立减"
      : tool.slug === "avatar-talking"
        ? "关注我，下条讲怎么选"
        : "现在就试试";

  const plan = buildShots({ durationSec, ratio, topic, point, cta });
  const tone = ratio.includes("横") ? "cool" : tool.slug === "avatar-net" ? "warm" : "ink";

  // 混剪多变体：只渲染前 2 个变体的关键帧，避免素材爆炸
  const variants = tool.slug === "video-mix" ? Math.min(2, countOf(input.count, 2)) : 1;

  const frames: Array<{ shotIndex: number; variant: number; asset: ReturnType<typeof publicAsset> }> = [];

  for (let v = 0; v < variants; v++) {
    for (const [i, shot] of plan.shots.entries()) {
      if (await isCanceled(job.id)) break;
      await stage(
        job.id,
        15 + Math.round((70 * (v * plan.shots.length + i)) / (variants * plan.shots.length)),
        `渲染分镜 ${i + 1} / ${plan.shots.length}${variants > 1 ? ` · 变体 ${v + 1}` : ""}`,
      );
      const png = await renderShot(shot, plan.shots.length, { width: plan.width, height: plan.height }, tone);
      const key = await put(
        job.org_id,
        job.id,
        `shot-${v + 1}-${String(i + 1).padStart(2, "0")}.png`,
        png,
        "image/png",
      );
      const asset = await addAsset({
        orgId: job.org_id,
        jobId: job.id,
        kind: "keyframe",
        role: "proxy",
        name: `分镜 ${i + 1}${variants > 1 ? ` · 变体 ${v + 1}` : ""}`,
        mime: "image/png",
        body: png,
        storageKey: key,
        width: Math.round(plan.width * 0.6),
        height: Math.round(plan.height * 0.6),
        meta: { shotIndex: shot.index, variant: v + 1, startMs: shot.startMs, endMs: shot.endMs },
      });
      frames.push({ shotIndex: shot.index, variant: v + 1, asset: publicAsset(asset) });
    }
  }

  const timeline: Timeline = {
    width: plan.width,
    height: plan.height,
    fps: 30,
    durationMs: plan.durationMs,
    shots: plan.shots,
    meta: {
      tool: tool.slug,
      ratio,
      variants,
      note: "本机无 FFmpeg，输出分镜关键帧 + 时间轴；接入 FFmpeg worker 后可直接编码成片",
    },
  };

  const timelineBuf = Buffer.from(JSON.stringify(timeline, null, 2), "utf8");
  const tlKey = await put(job.org_id, job.id, "timeline.json", timelineBuf, "application/json");
  const tlAsset = await addAsset({
    orgId: job.org_id,
    jobId: job.id,
    kind: "document",
    role: "metadata",
    name: "timeline.json",
    mime: "application/json",
    body: timelineBuf,
    storageKey: tlKey,
    meta: { shots: plan.shots.length, variants },
  });

  // ---- 云端成片（Seedance 2.5）：可选增强，失败不影响上面已产出的分镜 ----
  let videoAsset: ReturnType<typeof publicAsset> | null = null;
  let videoError: string | null = null;
  const vmodel = await modelFor(job, "video", "text2video");

  if (remoteOf(vmodel) && vmodel) {
    try {
      await stage(job.id, 82, `云端成片 · ${vmodel.spec.label}`);
      const task = await createVideoTaskArk({
        baseUrl: vmodel.baseUrl,
        apiKey: vmodel.apiKey,
        model: vmodel.spec.modelName,
        prompt: `${topic}｜${point}｜${cta}`,
        // 供应商只认 16:9 / 9:16 / 1:1
        ratio: ratio.includes("横") ? "16:9" : ratio.includes("方") ? "1:1" : "9:16",
        durationSec: Math.min(12, durationSec),
      });

      const deadline = Date.now() + 6 * 60 * 1000;
      let videoUrl: string | undefined;
      while (Date.now() < deadline) {
        if (await isCanceled(job.id)) break;
        await sleep(5000);
        const t = await fetchVideoTaskArk({
          baseUrl: vmodel.baseUrl,
          apiKey: vmodel.apiKey,
          model: vmodel.spec.modelName,
          taskId: task.taskId,
        });
        if (t.videoUrl) {
          videoUrl = t.videoUrl;
          break;
        }
        if (["failed", "canceled", "error"].includes(t.status)) {
          throw new Error(`Seedance 任务状态 ${t.status}`);
        }
        await stage(job.id, 85, `云端成片渲染中 · ${t.status}`);
      }
      if (!videoUrl) throw new Error("云端成片超时（6 分钟未返回）");

      const mp4 = await download(videoUrl);
      const vKey = await put(job.org_id, job.id, "final.mp4", mp4, "video/mp4");
      const vAsset = await addAsset({
        orgId: job.org_id,
        jobId: job.id,
        kind: "video",
        role: "final",
        name: "成片.mp4",
        mime: "video/mp4",
        body: mp4,
        storageKey: vKey,
        durationMs: durationSec * 1000,
        meta: { modelKey: vmodel.spec.key, taskId: task.taskId, ratio },
      });
      videoAsset = publicAsset(vAsset);
    } catch (err) {
      videoError = (err as Error).message;
      console.warn("[video] 云端成片失败，保留本地分镜：", videoError);
    }
  }

  if (videoAsset && vmodel) {
    await markModel(job, vmodel, durationSec * vmodel.spec.unitPrice);
  } else {
    await updateJob(job.id, {
      model_provider: "内置",
      model_name: "local-storyboard",
      prompt_version: PROMPT_VERSION,
      cost_cny: (frames.length * 0.01).toFixed(4),
    });
    await addUsage({
      orgId: job.org_id,
      jobId: job.id,
      provider: "内置",
      model: "local-storyboard",
      unit: "video_second",
      quantity: durationSec * variants,
      unitPrice: 0.004,
      costCny: Number((durationSec * variants * 0.004).toFixed(4)),
    });
  }

  return {
    type: "video",
    timeline,
    timelineAsset: publicAsset(tlAsset),
    frames,
    variants,
    /** 真实成片（云端可用时才有）；没有就只看分镜预览 */
    videoAsset,
    model: {
      key: videoAsset && vmodel ? vmodel.spec.key : "local-storyboard",
      label: videoAsset && vmodel ? vmodel.spec.label : "本地分镜渲染",
      keySource: videoAsset && vmodel ? vmodel.keySource : "platform",
    },
    local: !videoAsset,
    degraded: remoteOf(vmodel) && !videoAsset
      ? `云端成片不可用（${videoError ?? "未返回视频"}），已输出分镜关键帧 + 时间轴`
      : null,
  };
}
