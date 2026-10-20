/**
 * Next.js 启动钩子：建表、种子、启动内联 worker。
 * 生产建议把 worker 拆成独立进程（npm run worker），这里只是保证
 * `npm run dev` 一条命令就能跑通完整链路。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { ensureDb } = await import("@/lib/db");
    await ensureDb();
    console.log("[boot] 数据库就绪");

    const { ensureBucket } = await import("@/lib/storage");
    const bucket = await ensureBucket();
    console.log(`[boot] 存储就绪 · ${bucket}`);

    const { startWorker } = await import("@/lib/jobs/queue");
    startWorker(1);
  } catch (err) {
    // 不阻断启动：页面会通过 /api/health 显示具体不可用的依赖
    console.error("[boot] 初始化失败：", (err as Error).message);
    console.error("[boot] 请先执行 `docker compose up -d`，再运行 npm run dev");
  }
}
