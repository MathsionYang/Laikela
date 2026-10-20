/**
 * 环境自检：npm run doctor
 * 逐项检查外部依赖，给出可执行的修复建议。
 */
import "dotenv/config";

const g = "\x1b[32m";
const r = "\x1b[31m";
const y = "\x1b[33m";
const d = "\x1b[2m";
const x = "\x1b[0m";

const line = (ok: boolean, label: string, detail: string) =>
  console.log(`${ok ? `${g}OK ${x}` : `${r}NG ${x}`} ${label.padEnd(22)} ${d}${detail}${x}`);

async function main() {
  console.log(`\n${y}来客啦 · 环境自检${x}\n`);

  const results: boolean[] = [];

  // PostgreSQL
  try {
    const { dbHealth } = await import("../src/lib/jobs/repo");
    const h = await dbHealth();
    line(h.ok, "PostgreSQL", h.detail);
    results.push(h.ok);
  } catch (e) {
    line(false, "PostgreSQL", (e as Error).message);
    results.push(false);
  }

  // Redis
  try {
    const { queueHealth } = await import("../src/lib/jobs/queue");
    const h = await queueHealth();
    line(h.ok, "Redis / 队列", h.detail);
    results.push(h.ok);
  } catch (e) {
    line(false, "Redis / 队列", (e as Error).message);
    results.push(false);
  }

  // 对象存储
  try {
    const { storageHealth, ensureBucket } = await import("../src/lib/storage");
    await ensureBucket();
    const h = await storageHealth();
    line(h.ok, "对象存储", h.detail);
    results.push(h.ok);
  } catch (e) {
    line(false, "对象存储", (e as Error).message);
    results.push(false);
  }

  // 模型供应商
  const { env } = await import("../src/lib/env");
  line(
    true,
    "模型供应商",
    env.hasCloudProvider
      ? "已配置云端密钥，文案走真实模型"
      : "未配置密钥 → 本地规则引擎兜底（界面会标注）",
  );

  // FFmpeg（可选）
  const { spawnSync } = await import("node:child_process");
  const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  line(
    ff.status === 0,
    "FFmpeg（可选）",
    ff.status === 0
      ? "已安装，可扩展 mp4 编码"
      : "未安装 → 视频输出分镜关键帧 + 时间轴 JSON（不影响其他功能）",
  );

  const allOk = results.every(Boolean);
  console.log(
    `\n${allOk ? `${g}全部依赖就绪${x}` : `${y}存在未就绪依赖${x}`}\n` +
      (allOk
        ? ""
        : `${d}尝试：docker compose up -d   然后 npm run dev${x}\n`),
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
