import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { getJob } from "@/lib/jobs/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * SSE 进度流：文档 5.1 的 GET /api/jobs/:id/events
 * 每 700ms 读一次任务状态推给前端，终态后自动关闭。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let done = false;
      let timer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      };

      const send = (event: string, data: unknown) => {
        if (done) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      let lastKey = "";

      const tick = async () => {
        if (done) return;
        try {
          const job = await getJob(id, session.orgId);
          if (!job) {
            send("error", { message: "任务不存在" });
            cleanup();
            return;
          }
          const key = `${job.status}:${job.progress}:${job.stage}`;
          if (key !== lastKey) {
            lastKey = key;
            send("progress", {
              id: job.id,
              status: job.status,
              stage: job.stage,
              progress: job.progress,
              error: job.error_code
                ? { code: job.error_code, message: job.error_message }
                : null,
            });
          }
          if (TERMINAL.has(job.status)) {
            send("done", { status: job.status });
            cleanup();
          }
        } catch (err) {
          send("error", { message: (err as Error).message });
          cleanup();
        }
      };

      req.signal.addEventListener("abort", cleanup, { once: true });
      await tick();
      if (!done) timer = setInterval(() => void tick(), 700);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
