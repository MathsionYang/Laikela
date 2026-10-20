import { fail, ok } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { audit, getJob, requestCancel } from "@/lib/jobs/repo";
import { refund } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
  if (["succeeded", "failed", "canceled"].includes(job.status)) {
    return ok({ canceled: false, reason: `任务已处于 ${job.status} 状态` });
  }
  await requestCancel(id);
  const back = await refund({ orgId: session.orgId, jobId: id, reason: "用户取消，自动退回积分" });
  await audit({
    orgId: session.orgId,
    action: "job.canceled",
    target: id,
    detail: { refunded: back.credits },
  });
  return ok({ canceled: true, refunded: back.credits, balance: back.balance });
}
