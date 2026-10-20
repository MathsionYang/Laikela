import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getTool } from "@/lib/domain/tools";
import { audit, createJob, listJobs, updateJob } from "@/lib/jobs/repo";
import { enqueue } from "@/lib/jobs/queue";
import { clientJob } from "@/lib/jobs/serialize";
import { balance, consume } from "@/lib/credits";
import { planCodeOf } from "@/lib/billing";
import { listModelViews, quoteCost, resolveModel } from "@/lib/ai/router";
import type { ModelKind } from "@/lib/ai/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_KIND: Record<string, ModelKind> = {
  copy: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

export async function GET(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const sp = req.nextUrl.searchParams;
  const rows = await listJobs(session.orgId, {
    limit: Number(sp.get("limit") ?? 20),
    toolSlug: sp.get("tool") ?? undefined,
    status: sp.get("status") ?? undefined,
  });
  return ok(rows.map(clientJob));
}

/**
 * 创建任务 = 校验输入 → 定模型 → 预检余额 → 落库 → 扣积分 → 入队。
 *
 * 扣减放在入队之前：宁可任务没跑，也不能跑了不扣。
 * 失败/取消由 pipeline 与 cancel 接口负责退款（幂等键 job:<id>:refund）。
 *
 * 模型在这一步就定下来（写进 job.model_key），原因有两个：
 *  1. 前端要能提前显示「这次用哪个模型、扣多少积分」
 *  2. 用户明确选了模型却被静默换成别的，是不可接受的
 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await readJson<{
    tool?: string;
    input?: Record<string, unknown>;
    modelKey?: string | null;
  }>(req);
  const tool = body.tool ? getTool(body.tool) : undefined;
  if (!tool) return fail("NO_TOOL", `未知工具：${body.tool ?? "(空)"}`, 404);

  const input = body.input ?? {};
  for (const f of tool.fields) {
    if (f.required && !String(input[f.id] ?? "").trim()) {
      return fail("INVALID_INPUT", `请先填写「${f.label}」`, 422, { field: f.id });
    }
  }

  // ---- 定模型 ----
  const planCode = await planCodeOf(session.orgId);
  const kind = MODEL_KIND[tool.kind] ?? "text";
  if (body.modelKey) {
    const views = await listModelViews(session.orgId, planCode);
    const picked = views.find((v) => v.key === body.modelKey);
    if (!picked) return fail("NO_MODEL", `未知模型：${body.modelKey}`, 422);
    if (picked.kind !== kind) {
      return fail("MODEL_MISMATCH", `模型「${picked.label}」不能用于该工具`, 422);
    }
    if (!picked.usable) {
      return fail("MODEL_UNAVAILABLE", `模型「${picked.label}」不可用：${picked.reason ?? "未知原因"}`, 409);
    }
  }

  const model = await resolveModel({
    orgId: session.orgId,
    kind,
    planCode,
    preferredKey: body.modelKey ?? undefined,
    capability: tool.kind === "copy" ? "copy" : undefined,
  });
  const cost = quoteCost(tool.creditCost, model);

  const before = await balance(session.orgId);
  if (before < cost) {
    return fail(
      "INSUFFICIENT_CREDITS",
      `积分不足：本次需要 ${cost} 点，当前剩余 ${before} 点，请升级套餐或等下月发放`,
      402,
      { required: cost, balance: before },
    );
  }

  const job = await createJob({
    orgId: session.orgId,
    toolSlug: tool.slug,
    input,
    modelKey: model.spec.key,
  });

  const charged = await consume({
    orgId: session.orgId,
    jobId: job.id,
    credits: cost,
    reason: `生成任务 · ${tool.name}`,
  });
  if (!charged.ok) {
    // 预检通过但并发扣减失败（别的请求刚花掉）：回收任务，返回 402
    await updateJob(job.id, { status: "canceled", stage: "积分不足", finished: true });
    return fail("INSUFFICIENT_CREDITS", "积分不足，请充值后再试", 402, {
      required: cost,
      balance: charged.balance,
    });
  }

  await enqueue(job.id);
  await audit({
    orgId: session.orgId,
    action: "job.created",
    target: job.id,
    detail: {
      tool: tool.slug,
      model: model.spec.key,
      keySource: model.keySource,
      credits: cost,
      balance: charged.balance,
    },
  });

  return ok(
    {
      ...clientJob(job),
      model: { key: model.spec.key, label: model.spec.label, keySource: model.keySource },
      credits: { cost, balance: charged.balance },
    },
    { status: 201 },
  );
}
