/**
 * 独立 worker 进程。
 * 生产形态：与 Next 分离部署，可多实例水平扩展（BullMQ 保证任务不重复消费）。
 * 开发时可以不启动——instrumentation 会在 Next 进程内跑一个 concurrency=1 的内联 worker。
 */
import "dotenv/config";
import { ensureDb } from "../src/lib/db";
import { ensureBucket } from "../src/lib/storage";
import { startWorker, queueHealth } from "../src/lib/jobs/queue";

async function main() {
  console.log("[worker] booting…");
  await ensureDb();
  console.log("[worker] db ready");
  await ensureBucket();
  const q = await queueHealth();
  console.log(`[worker] queue ${q.ok ? "ok" : "down"} · ${q.detail}`);

  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
  startWorker(concurrency);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, exiting`);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] 启动失败：", err);
  process.exit(1);
});
