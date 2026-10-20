import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { audit } from "@/lib/jobs/repo";
import {
  createEndpoint,
  deleteEndpoint,
  listEndpoints,
  setEndpointEnabled,
  type EndpointKind,
} from "@/lib/ai/custom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出当前空间接入的自定义端点（Key 只返回掩码） */
export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  return ok({ endpoints: await listEndpoints(guard.session.orgId) });
}

/**
 * 接入一个 OpenAI 协议兼容的端点。
 * 只有三个必填值：Base URL、模型名、Key —— 其余都是可选的展示/计费信息。
 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以接入模型", 403);
  }

  const body = await readJson<{
    name?: string;
    kind?: EndpointKind;
    baseUrl?: string;
    modelName?: string;
    apiKey?: string;
    contextK?: number;
    credits?: number;
  }>(req);

  try {
    const endpoint = await createEndpoint({
      orgId: session.orgId,
      name: body.name ?? "",
      kind: body.kind === "image" ? "image" : "text",
      baseUrl: body.baseUrl ?? "",
      modelName: body.modelName ?? "",
      apiKey: body.apiKey ?? "",
      contextK: body.contextK ?? null,
      credits: body.credits,
      createdBy: session.id,
    });
    await audit({
      orgId: session.orgId,
      action: "endpoint.created",
      target: endpoint.id,
      detail: { name: endpoint.name, baseUrl: endpoint.baseUrl, model: endpoint.modelName },
    });
    return ok({ endpoint }, { status: 201 });
  } catch (err) {
    return fail("ENDPOINT_INVALID", (err as Error).message, 422);
  }
}

/** 启停 / 删除 */
export async function PATCH(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以操作模型", 403);
  }
  const body = await readJson<{ id?: string; enabled?: boolean }>(req);
  if (!body.id || typeof body.enabled !== "boolean") {
    return fail("BAD_REQUEST", "缺少 id 或 enabled", 422);
  }
  await setEndpointEnabled(session.orgId, body.id, body.enabled);
  return ok({ endpoints: await listEndpoints(session.orgId) });
}

export async function DELETE(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以删除模型", 403);
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("BAD_REQUEST", "缺少 id", 422);
  await deleteEndpoint(session.orgId, id);
  await audit({ orgId: session.orgId, action: "endpoint.deleted", target: id });
  return ok({ endpoints: await listEndpoints(session.orgId) });
}
