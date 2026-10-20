import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { audit } from "@/lib/jobs/repo";
import {
  deleteCredential,
  listCredentials,
  saveCredential,
  type ProviderId,
} from "@/lib/ai/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isProvider = (v: unknown): v is ProviderId => v === "deepseek" || v === "doubao";

/** 只看状态：返回的是掩码，永远不回传明文 */
export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  return ok({ credentials: await listCredentials(guard.session.orgId) });
}

/**
 * 保存 / 覆盖 BYOK。
 * 只允许组织管理员（owner/admin）操作 —— Key 是组织级资产，不是个人偏好。
 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以配置 API Key", 403);
  }

  const body = await readJson<{ provider?: string; apiKey?: string; label?: string }>(req);
  if (!isProvider(body.provider)) {
    return fail("BAD_PROVIDER", "不支持的供应商", 422);
  }
  if (!body.apiKey?.trim()) {
    return fail("NO_KEY", "请填写 API Key", 422);
  }

  try {
    const view = await saveCredential({
      orgId: session.orgId,
      provider: body.provider,
      apiKey: body.apiKey,
      label: body.label,
      createdBy: session.id,
    });
    await audit({
      orgId: session.orgId,
      action: "credential.saved",
      target: body.provider,
      detail: { hint: view.keyHint, label: view.label },
    });
    return ok({ credential: view }, { status: 201 });
  } catch (err) {
    return fail("SAVE_FAILED", (err as Error).message, 400);
  }
}

/** 删除 BYOK：删掉后该供应商回落到平台 Key（若已配置） */
export async function DELETE(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  if (session.role !== "owner" && session.role !== "admin") {
    return fail("FORBIDDEN", "只有空间管理员可以操作 API Key", 403);
  }

  const provider = new URL(req.url).searchParams.get("provider");
  if (!isProvider(provider)) return fail("BAD_PROVIDER", "不支持的供应商", 422);

  await deleteCredential(session.orgId, provider);
  await audit({ orgId: session.orgId, action: "credential.deleted", target: provider });
  return ok({ credentials: await listCredentials(session.orgId) });
}
