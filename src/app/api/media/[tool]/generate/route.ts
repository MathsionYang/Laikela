import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getTool } from "@/lib/domain/tools";
import { audit, createJob } from "@/lib/jobs/repo";
import { enqueue } from "@/lib/jobs/queue";
import { clientJob } from "@/lib/jobs/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 图片 / 音频 / 视频快捷接口：异步，返回 job。
 * 媒体任务耗时不可控，一律走任务 + SSE 进度，不做同步等待。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tool: string }> },
) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const { tool: slug } = await params;
  const tool = getTool(slug);
  if (!tool) return fail("NO_TOOL", `未知工具：${slug}`, 404);
  if (tool.kind === "copy") {
    return fail("WRONG_KIND", `${tool.name} 是文案工具，请改用 /api/copy/${slug}/generate`, 400);
  }

  const body = await readJson<{ input?: Record<string, unknown> }>(req);
  const input = body.input ?? {};
  for (const f of tool.fields) {
    if (f.required && !String(input[f.id] ?? "").trim()) {
      return fail("INVALID_INPUT", `请先填写「${f.label}」`, 422, { field: f.id });
    }
  }

  const job = await createJob({ orgId: session.orgId, toolSlug: tool.slug, input });
  await enqueue(job.id);
  await audit({
    orgId: session.orgId,
    action: "job.created",
    target: job.id,
    detail: { tool: tool.slug, via: "media.generate" },
  });

  return ok(
    {
      job: clientJob(job),
      events: `/api/jobs/${job.id}/events`,
      poll: `/api/jobs/${job.id}`,
    },
    { status: 202 },
  );
}
