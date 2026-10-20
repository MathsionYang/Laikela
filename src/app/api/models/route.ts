import { fail, ok, readJson } from "@/lib/api";
import { ensureDb, q } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { planCodeOf } from "@/lib/billing";
import { audit } from "@/lib/jobs/repo";
import { listModelViews } from "@/lib/ai/router";
import { listCredentials } from "@/lib/ai/credentials";
import { listEndpoints } from "@/lib/ai/custom";
import { PLAN_RANK, modelByKey } from "@/lib/ai/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 模型目录 + 当前租户视角下的可用性。
 *
 * 一次返回三样东西，前端据此既能渲染「选模型」下拉，也能渲染「设置 Key」表单：
 *  - models：每个模型的协议、单价、所需套餐、是否可用、不可用原因、Key 来源
 *  - credentials：当前租户在两个供应商上的 BYOK 状态（只有掩码，没有明文）
 *  - plan：当前套餐等级，用于高亮权限
 */
export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const { orgId, role } = guard.session;

  const planCode = await planCodeOf(orgId);
  const [models, credentials, endpoints] = await Promise.all([
    listModelViews(orgId, planCode),
    listCredentials(orgId),
    listEndpoints(orgId),
  ]);

  return ok({
    planCode,
    planRank: PLAN_RANK[planCode] ?? 0,
    canManageKeys: role === "owner" || role === "admin",
    models: models.map((m) => ({
      key: m.key,
      provider: m.provider,
      vendor: m.vendor,
      label: m.label,
      kind: m.kind,
      protocol: m.protocol,
      modelName: m.modelName,
      contextK: m.contextK ?? null,
      unit: m.unit,
      unitPrice: m.unitPrice,
      credits: m.credits,
      requiresPlan: m.requiresPlan,
      capabilities: m.capabilities,
      byokOnly: Boolean(m.byokOnly),
      fallback: m.fallback ?? null,
      note: m.note,
      enabled: m.enabled,
      available: m.available,
      keySource: m.keySource,
      allowedByPlan: m.allowedByPlan,
      usable: m.usable,
      reason: m.reason ?? null,
    })),
    credentials,
    endpoints,
  });
}

/**
 * 运行时开关：启停某个模型。
 * 只动 model_catalog 表，不改代码 —— 发版才改的目录、随时可改的开关，分开。
 */
export async function PATCH(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以调整模型开关", 403);
  }

  const body = await readJson<{ key?: string; enabled?: boolean }>(req);
  if (!body.key || typeof body.enabled !== "boolean") {
    return fail("BAD_REQUEST", "缺少 key 或 enabled", 422);
  }
  if (!modelByKey(body.key)) return fail("NO_MODEL", `未知模型：${body.key}`, 404);

  await q(
    `insert into model_catalog (key, enabled) values ($1,$2)
     on conflict (key) do update set enabled = excluded.enabled, updated_at = now()`,
    [body.key, body.enabled],
  );
  await audit({
    orgId: session.orgId,
    action: "model.toggled",
    target: body.key,
    detail: { enabled: body.enabled },
  });
  return ok({ key: body.key, enabled: body.enabled });
}
