"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LineChart } from "@/components/charts/LineChart";
import { apiPost, useUsage } from "@/lib/client/api";

interface Trend {
  id: string;
  platform: string;
  keyword: string;
  heat: number;
  growth: number;
  confidence: number;
  source: string;
  capturedAt: string;
}

export default function GrowthPage() {
  const { data: usage } = useUsage();
  const { data, isLoading } = useQuery({
    queryKey: ["trends"],
    queryFn: () => apiPost<{ items: Trend[]; notice?: string }>("/api/research/trends", { limit: 20 }),
  });

  const daily = (usage?.daily ?? []).map((d) => ({ label: d.day, value: d.runs }));
  const totalRuns = usage?.byTool.reduce((a, b) => a + b.runs, 0) ?? 0;
  const avgCost = totalRuns ? (usage?.monthCost ?? 0) / totalRuns : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="eyebrow">GROWTH BOARD</div>
        <h1 className="serif text-[26px] leading-tight sm:text-[30px]">增长看板</h1>
        <p className="text-[12px]" style={{ color: "var(--t3)" }}>
          热点信号、内容产能与单位成本。数据来源与采集时间都可追溯。
        </p>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-y lg:grid-cols-4 lg:divide-y-0" style={{ borderColor: "var(--line)" }}>
        {[
          { label: "本月生成", value: totalRuns, unit: "条" },
          { label: "本月成本", value: `¥${(usage?.monthCost ?? 0).toFixed(2)}`, unit: "" },
          { label: "单条平均成本", value: `¥${avgCost.toFixed(3)}`, unit: "" },
          { label: "剩余积分", value: Math.round(usage?.remaining ?? 0), unit: "" },
        ].map((c) => (
          <div key={c.label} className="px-4 py-3.5" style={{ borderColor: "var(--line)" }}>
            <div className="text-[10.5px]" style={{ color: "var(--t3)" }}>
              {c.label}
            </div>
            <div className="mono mt-1 text-[21px] leading-none" style={{ color: "var(--t1)" }}>
              {c.value}
              {c.unit && <span className="ml-1 text-[11px]" style={{ color: "var(--t3)" }}>{c.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card p-4 lg:p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <div className="eyebrow">HOT SIGNALS</div>
              <h2 className="serif mt-1 text-[16px]">正在上涨的话题</h2>
            </div>
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {data?.items.length ?? 0} 条
            </span>
          </div>

          {isLoading && <div className="skeleton h-[240px]" />}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
              <thead>
                <tr style={{ color: "var(--t3)" }}>
                  <th className="pb-2 text-left font-normal">关键词</th>
                  <th className="pb-2 text-left font-normal">平台</th>
                  <th className="pb-2 text-right font-normal">热度</th>
                  <th className="pb-2 text-right font-normal">增长</th>
                  <th className="pb-2 text-right font-normal">置信</th>
                  <th className="pb-2 text-right font-normal">跟进</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((t) => (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="py-2 pr-2" style={{ color: "var(--t1)" }}>
                      {t.keyword}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="chip">{t.platform}</span>
                    </td>
                    <td className="mono py-2 text-right" style={{ color: "var(--t2)" }}>
                      {(t.heat / 1000).toFixed(0)}k
                    </td>
                    <td className="mono py-2 text-right" style={{ color: "var(--jade)" }}>
                      +{Math.round(t.growth)}%
                    </td>
                    <td className="mono py-2 text-right" style={{ color: "var(--t3)" }}>
                      {t.confidence.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/tools/growth-trend`}
                        className="text-[10.5px]"
                        style={{ color: "var(--gold)" }}
                      >
                        跟进
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data?.notice && (
            <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed" style={{ color: "var(--t3)" }}>
              <Icon name="alert" size={12} style={{ marginTop: 2, flexShrink: 0 }} />
              {data.notice}
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="card p-4">
            <div className="eyebrow">PRODUCTION</div>
            <h2 className="serif mt-1 mb-2 text-[14px]">近 30 天产出</h2>
            {daily.length ? <LineChart data={daily} height={132} unit="条" /> : <div className="skeleton h-[132px]" />}
          </section>

          <section className="card p-4">
            <div className="eyebrow">COST BY TOOL</div>
            <h2 className="serif mt-1 mb-2 text-[14px]">成本构成</h2>
            <ul className="flex flex-col gap-2">
              {(usage?.byTool ?? []).slice(0, 5).map((t) => {
                const max = Math.max(...(usage?.byTool ?? []).map((x) => x.cost), 0.001);
                return (
                  <li key={t.tool}>
                    <div className="flex items-baseline justify-between text-[10.5px]">
                      <span style={{ color: "var(--t2)" }}>{t.tool}</span>
                      <span className="mono" style={{ color: "var(--t3)" }}>
                        ¥{t.cost.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(4, (t.cost / max) * 100)}%`, background: "var(--gold)" }}
                      />
                    </div>
                  </li>
                );
              })}
              {!usage?.byTool.length && (
                <li className="text-[11px]" style={{ color: "var(--t3)" }}>
                  本月还没有消耗
                </li>
              )}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
