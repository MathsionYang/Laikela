import { Queue, Worker, type Job as BullJob } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { runJob } from "./pipeline";
import { getJob } from "./repo";

/**
 * 任务队列。两种实现：
 *  - redis ：BullMQ + Redis，生产形态，可多实例水平扩展、崩溃后自动重投
 *  - memory：进程内队列，零依赖，`npm run dev` 直接可用
 *
 * QUEUE_DRIVER=auto 时先探 Redis（1.5s 超时），连不上就降级到内存队列。
 * 任务状态本身写在数据库里，所以两种队列可以随时互换，前端无感。
 */
type Mode = "redis" | "memory";

declare global {
  // eslint-disable-next-line no-var
  var __laikelaRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __laikelaQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __laikelaWorker: Worker | undefined;
  // eslint-disable-next-line no-var
  var __laikelaMode: Promise<Mode> | undefined;
  // eslint-disable-next-line no-var
  var __laikelaMem: { pending: string[]; running: number; concurrency: number; done: number; failed: number } | undefined;
}

export function redis(): IORedis {
  if (!globalThis.__laikelaRedis) {
    globalThis.__laikelaRedis = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 1_500,
      retryStrategy: (times) => (times > 3 ? null : 500),
    });
    globalThis.__laikelaRedis.on("error", (e) =>
      console.error("[redis]", (e as Error).message),
    );
  }
  return globalThis.__laikelaRedis;
}

function probeRedis(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new IORedis(env.redisUrl, {
      lazyConnect: true,
      connectTimeout: 1_500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const done = (ok: boolean) => {
      client.disconnect();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 1_600);
    client
      .connect()
      .then(() => client.ping())
      .then((pong) => {
        clearTimeout(timer);
        done(pong === "PONG");
      })
      .catch(() => {
        clearTimeout(timer);
        done(false);
      });
  });
}

export function queueMode(): Promise<Mode> {
  if (!globalThis.__laikelaMode) {
    globalThis.__laikelaMode = (async (): Promise<Mode> => {
      if (env.queue.driver === "memory") return "memory";
      if (env.queue.driver === "redis") return "redis";
      const ok = await probeRedis();
      if (!ok) {
        console.warn("[queue] Redis 不可用，已降级为进程内队列（单机模式）");
        return "memory";
      }
      return "redis";
    })();
  }
  return globalThis.__laikelaMode;
}

/* ------------------------------- Redis 形态 ------------------------------- */

function jobQueue(): Queue {
  if (!globalThis.__laikelaQueue) {
    globalThis.__laikelaQueue = new Queue(env.queue.name, { connection: redis() });
  }
  return globalThis.__laikelaQueue;
}

function startBull(concurrency: number): Worker {
  if (globalThis.__laikelaWorker) return globalThis.__laikelaWorker;
  const worker = new Worker(env.queue.name, handle, {
    connection: redis(),
    concurrency,
    lockDuration: 120_000,
  });
  worker.on("completed", (j) => console.log(`[worker] ✓ ${j.id}`));
  worker.on("failed", (j, err) =>
    console.error(`[worker] ✗ ${j?.id} attempt=${j?.attemptsMade} ${err.message}`),
  );
  worker.on("error", (err) => console.error("[worker] error", err.message));
  globalThis.__laikelaWorker = worker;
  console.log(`[worker] started · redis queue=${env.queue.name} concurrency=${concurrency}`);
  return worker;
}

async function handle(job: BullJob): Promise<void> {
  const jobId = (job.data as { jobId?: string }).jobId;
  if (!jobId) return;
  await runById(jobId);
}

/* ------------------------------- 内存形态 -------------------------------- */

function mem() {
  if (!globalThis.__laikelaMem) {
    globalThis.__laikelaMem = { pending: [], running: 0, concurrency: 1, done: 0, failed: 0 };
  }
  return globalThis.__laikelaMem;
}

function pump(): void {
  const m = mem();
  while (m.running < m.concurrency && m.pending.length > 0) {
    const jobId = m.pending.shift()!;
    m.running++;
    void (async () => {
      try {
        await runById(jobId);
        m.done++;
      } catch (err) {
        m.failed++;
        console.error("[worker] memory job failed", (err as Error).message);
      } finally {
        m.running--;
        pump();
      }
    })();
  }
}

function enqueueMemory(jobId: string): void {
  const m = mem();
  if (!m.pending.includes(jobId)) m.pending.push(jobId);
  if (m.concurrency > 0) pump();
}

function startMemory(concurrency: number): void {
  const m = mem();
  m.concurrency = Math.max(1, concurrency);
  console.log(`[worker] started · in-process queue concurrency=${m.concurrency}`);
  pump();
}

/* --------------------------------- 统一出口 -------------------------------- */

async function runById(jobId: string): Promise<void> {
  const row = await getJob(jobId);
  if (!row) {
    console.warn("[worker] job 不存在", jobId);
    return;
  }
  // 已终态或已取消的不再执行
  if (["succeeded", "failed", "canceled"].includes(row.status)) return;
  if (row.cancel_requested) return;
  await runJob(row);
}

/** 入队。jobId 同时作为 BullMQ 的 jobId，天然幂等 */
export async function enqueue(jobId: string): Promise<void> {
  if ((await queueMode()) === "memory") {
    enqueueMemory(jobId);
    return;
  }
  await jobQueue().add(
    "run",
    { jobId },
    {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 4000 },
      removeOnComplete: { count: 300 },
      removeOnFail: { count: 300 },
    },
  );
}

/**
 * 启动 worker。
 * - 独立进程（npm run worker）：生产形态，可多实例水平扩展
 * - Next 进程内联（instrumentation）：开发时一条命令即可跑通
 * BullMQ 保证同一个 job 只会被一个 worker 取走，两种方式可以共存。
 */
export function startWorker(concurrency = env.queue.concurrency): void {
  void queueMode().then((mode) => {
    if (mode === "redis") startBull(concurrency);
    else startMemory(concurrency);
  });
}

export async function queueHealth(): Promise<{ ok: boolean; detail: string }> {
  const mode = await queueMode();
  if (mode === "memory") {
    const m = mem();
    return {
      ok: true,
      detail: `进程内队列 · 等待 ${m.pending.length} / 执行中 ${m.running} / 完成 ${m.done} / 失败 ${m.failed}`,
    };
  }
  try {
    const pong = await redis().ping();
    const counts = await jobQueue().getJobCounts("waiting", "active", "completed", "failed");
    return {
      ok: pong === "PONG",
      detail: `Redis ${pong} · 等待 ${counts.waiting ?? 0} / 执行中 ${counts.active ?? 0} / 完成 ${
        counts.completed ?? 0
      } / 失败 ${counts.failed ?? 0}`,
    };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
