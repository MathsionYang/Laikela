/**
 * 工具实测统计 —— 「预计耗时」不能靠拍脑袋，得从真跑过的任务里算。
 *
 * 取近 90 天成功任务的中位耗时（p50），按「本地引擎 / 云端模型」分桶：
 * 本地引擎几百毫秒到几秒，云端模型受网络与排队影响，混在一起算没有意义。
 *
 * 刻意排除两类数据：
 *   · 演示种子任务（output.demo = true）—— 它们的 finished_at 是按估值造的，不是实测
 *   · 失败 / 取消的任务 —— 半路挂掉的时间不代表正常耗时
 */
import { q } from "@/lib/db";
import { LOCAL_ETA_FACTOR } from "@/lib/domain/pricing";

export interface RunBucket {
  /** 样本数 */
  n: number;
  /** 中位耗时（秒） */
  p50: number;
  /** 90 分位耗时（秒），用于「慢的时候大概多久」 */
  p90: number;
}

export interface ToolRunStat {
  local: RunBucket | null;
  remote: RunBucket | null;
}

/** 少于这个样本数就不采信实测值，回落到基线 */
export const MIN_SAMPLES = 3;

export async function toolRunStats(): Promise<Map<string, ToolRunStat>> {
  const rows = await q<{
    tool_slug: string;
    is_local: boolean;
    n: string;
    p50: string | null;
    p90: string | null;
  }>(
    `select tool_slug,
            (model_key is null or model_key like 'local-%') as is_local,
            count(*)::text as n,
            percentile_cont(0.5) within group (
              order by extract(epoch from (finished_at - started_at))
            )::text as p50,
            percentile_cont(0.9) within group (
              order by extract(epoch from (finished_at - started_at))
            )::text as p90
       from jobs
      where status = 'succeeded'
        and started_at is not null
        and finished_at is not null
        and finished_at > started_at
        and created_at > now() - interval '90 days'
        and coalesce(output->>'demo', '') <> 'true'
        -- 降级任务（云端失败 → 本地兜底）不能算进任何一档的耗时：
        -- 它们跑的是本地引擎，却挂在云端模型名下，会把「实测」拉成 0.1 秒
        and (output->>'degraded') is null
      group by 1, 2`,
  );

  const out = new Map<string, ToolRunStat>();
  for (const r of rows) {
    const bucket: RunBucket = {
      n: Number(r.n),
      p50: Number(r.p50 ?? 0),
      p90: Number(r.p90 ?? 0),
    };
    const cur = out.get(r.tool_slug) ?? { local: null, remote: null };
    if (r.is_local) cur.local = bucket;
    else cur.remote = bucket;
    out.set(r.tool_slug, cur);
  }
  return out;
}

/**
 * 挑一个可信的耗时：优先「同一档引擎」的实测值，样本不够就回落到基线。
 *
 * 基线是按云端模型估的，本地引擎不跑网络、不出图，实测大约只要 70%
 * （15 个工具实测比值的中位数；文案类因为云端要出 JSON，落得更多）。
 * 用 0.7 折算而不是原值，冷启动阶段就不会把「本地 14 秒」写成「20 秒」。
 */
export function pickEta(
  stat: ToolRunStat | undefined,
  isLocal: boolean,
  baseline: number,
): { seconds: number; source: "measured" | "baseline"; samples: number } {
  const bucket = isLocal ? stat?.local : stat?.remote;
  if (bucket && bucket.n >= MIN_SAMPLES && bucket.p50 > 0) {
    return { seconds: Math.max(1, Math.round(bucket.p50)), source: "measured", samples: bucket.n };
  }
  const fallback = isLocal ? Math.max(1, Math.round(baseline * LOCAL_ETA_FACTOR)) : baseline;
  return { seconds: fallback, source: "baseline", samples: bucket?.n ?? 0 };
}
