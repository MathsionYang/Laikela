import { fail, ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getJob, listAssets } from "@/lib/jobs/repo";
import { clientAsset, clientJob } from "@/lib/jobs/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const { id } = await params;
  const job = await getJob(id, session.orgId);
  if (!job) return fail("NOT_FOUND", "任务不存在", 404);

  const assets = await listAssets(session.orgId, { jobId: id, limit: 200 });
  return ok({ job: clientJob(job), assets: assets.map((a) => clientAsset(a)) });
}

/** 局部重写：把当前文档内容作为新输入再跑一次（保留父任务关系） */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const { id } = await params;
  const job = await getJob(id, session.orgId);
  if (!job) return fail("NOT_FOUND", "任务不存在", 404);

  let patch: { docHtml?: string; docTitle?: string } = {};
  try {
    patch = (await req.json()) as typeof patch;
  } catch {
    /* 忽略空 body */
  }

  if (patch.docHtml !== undefined) {
    const { q } = await import("@/lib/db");
    const title = patch.docTitle ?? null;
    const rows = await q<{ title: string }>(
      `update copy_documents set content_html = $1, title = coalesce($2, title), updated_at = now()
       where job_id = $3
       returning title`,
      [patch.docHtml, title, id],
    );

    // 素材库里那份 .md 跟着改：否则用户下载到的还是第一次生成的旧稿
    if (rows.length) {
      const { htmlToPlain, refreshTextAsset } = await import("@/lib/assets");
      await refreshTextAsset({
        orgId: session.orgId,
        jobId: id,
        title: rows[0].title,
        plain: htmlToPlain(patch.docHtml),
      });
    }
  }
  return ok({ saved: true });
}
