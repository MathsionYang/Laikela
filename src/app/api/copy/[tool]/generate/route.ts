import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getTool } from "@/lib/domain/tools";
import { audit, createJob, getJob } from "@/lib/jobs/repo";
import { enqueue } from "@/lib/jobs/queue";
import { clientJob } from "@/lib/jobs/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 文案类快捷接口：一次调用拿结果（内部仍是 job，最长等 55 秒）。
 * 长任务请用 /api/jobs + SSE。
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
  if (tool.kind !== "copy") {
    return fail("WRONG_KIND", `${tool.name} 不是文案工具，请改用 /api/media/${slug}/generate`, 400);
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
    detail: { tool: tool.slug, via: "copy.generate" },
  });

  const deadline = Date.now() + 55_000;
  let current = job;
  while (Date.now() < deadline) {
    await sleep(400);
    const fresh = await getJob(job.id, session.orgId);
    if (!fresh) break;
    current = fresh;
    if (["succeeded", "failed", "canceled"].includes(fresh.status)) break;
  }

  if (current.status === "succeeded") {
    return ok({ job: clientJob(current), output: current.output });
  }
  if (current.status === "failed") {
    return fail(
      current.error_code ?? "FAILED",
      current.error_message ?? "生成失败",
      502,
      clientJob(current),
    );
  }
  // 超时未完成：返回 202，调用方继续用 /api/jobs/:id
  return ok({ job: clientJob(current), pending: true }, { status: 202 });
}
