import { fail, ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getAsset, deleteAssets } from "@/lib/assets";
import { clientAsset } from "@/lib/jobs/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单个素材的元信息（文字预览面板会用到） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const asset = await getAsset(guard.session.orgId, id);
  if (!asset) return fail("NOT_FOUND", "素材不存在或已删除", 404);
  return ok(clientAsset(asset));
}

/**
 * 删除素材：连文件一起删（存储 + 数据库行 + 缩略图）。
 * 只删行不删文件，本地目录会越攒越大且再也无法回收 —— 所以两件事必须一起做。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const removed = await deleteAssets(guard.session.orgId, [id], {
    id: guard.session.id,
    email: guard.session.email,
  });
  if (!removed.length) return fail("NOT_FOUND", "素材不存在或已删除", 404);

  return ok({ deleted: removed[0] });
}
