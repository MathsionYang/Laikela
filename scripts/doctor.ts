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

  // 模型供应商：配了 Key 就真探一次 —— 「Key 有效」和「模型名存在」是两件事，
  // 只写着「已配置云端密钥」会让人以为链路通了，实际可能一调就 400。
  const { env } = await import("../src/lib/env");
  const ds = env.providers.deepseek;
  if (!ds.apiKey) {
    line(
      true,
      "模型供应商",
      "未配置 DEEPSEEK_API_KEY → 本地规则引擎兜底（界面会标注）；接真模型：填 Key 后跑 npm run check:ai",
    );
  } else {
    try {
      const res = await fetch(`${ds.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { authorization: `Bearer ${ds.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        line(false, "模型供应商", `GET /models 返回 HTTP ${res.status}（Key 无效或被限流）；跑 npm run check:ai 看详情`);
        results.push(false);
      } else {
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        const ids = (body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
        const okName = ids.includes(ds.model);
        line(
          okName,
          "模型供应商",
          okName
            ? `DeepSeek ${ds.model} 就绪 · 账号可用 ${ids.length} 个模型`
            : `DEEPSEEK_MODEL=${ds.model} 不在账号模型列表（可用：${ids.join(" / ") || "空"}）`,
        );
        if (!okName) results.push(false);
      }
    } catch (e) {
      line(false, "模型供应商", `不可达：${(e as Error).message}（检查出网/代理）`);
      results.push(false);
    }
  }

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
