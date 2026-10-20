"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { LineChart } from "@/components/charts/LineChart";
import { ToolTile } from "@/components/home/ToolTile";
import {
  useDashboard,
  useHealth,
  useJobList,
  useTools,
  type DashboardPayload,
} from "@/lib/client/api";

const SECTIONS = [
  { key: "all", label: "全部能力" },
  { key: "copy", label: "AI 文案" },
  { key: "image", label: "图片与素材" },
  { key: "video", label: "视频工坊" },
  { key: "avatar", label: "AI 数字人" },
  { key: "growth", label: "增长运营" },
];

const STATUS_DOT: Record<string, string> = {
  queued: "dot-queued",
  running: "dot-running",
  post_processing: "dot-running",
  reviewing: "dot-running",
  succeeded: "dot-ok",
  failed: "dot-fail",
  canceled: "dot-queued",
};

export default function HomePage() {
  const { data, isLoading } = useDashboard();
  const { data: toolsData } = useTools();
  const { data: health } = useHealth();
  const [section, setSection] = useState("all");

  const tools = (toolsData?.tools ?? []).filter(
    (t) => section === "all" || t.section === section,
  );

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <Hero metrics={data?.metrics} health={health} />

      <MetricLedger metrics={data?.metrics} loading={isLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_306px]">
        <ChartCard data={data} loading={isLoading} />
        <TrendCard trends={data?.trends ?? []} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_306px]">
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="serif text-[19px] leading-tight">内容能力中心</h2>
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--t3)" }}>
                从一个想法，到一条能发布的内容资产
              </p>
            </div>
            <Link
              href="/tools"
              className="flex items-center gap-1 text-[11.5px]"
              style={{ color: "var(--gold)" }}
            >
              全部能力 <Icon name="arrow" size={12} />
            </Link>
          </div>

          <div
            className="mb-3 flex gap-1 overflow-x-auto border-b"
            style={{ borderColor: "var(--line)" }}
            role="tablist"
          >
            {SECTIONS.map((s) => {
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSection(s.key)}
                  className="relative shrink-0 px-2.5 pb-2 pt-1 text-[12px] transition-colors"
                  style={{ color: active ? "var(--t1)" : "var(--t3)" }}
                >
                  {s.label}
                  {active && (
                    <span
                      className="absolute inset-x-1 -bottom-px h-[2px] rounded-full"
                      style={{ background: "var(--gold)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {tools.map((t) => (
              <ToolTile key={t.slug} tool={t} runs={t.runs} quote={t.quote} />
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <JobQueueCard />
          <QuickActions />
        </aside>
      </div>
    </div>
  );
}

function Hero({
  metrics,
  health,
}: {
  metrics?: DashboardPayload["metrics"];
  health?: { mode: string; checks: Array<{ ok: boolean }> } | undefined;
}) {
  const ok = health?.checks.every((c) => c.ok);
  return (
    <section className="animate-rise flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="eyebrow mb-2">AI CONTENT OPERATING SYSTEM</div>
        <h1 className="serif text-[30px] leading-[1.16] sm:text-[38px] lg:text-[42px]">
          让每一条内容，
          <br />
          <span style={{ color: "var(--gold)" }}>都更接近爆款。</span>
        </h1>
        <p
          className="mt-3 max-w-[46ch] text-[12.5px] leading-[1.7] sm:text-[13px]"
          style={{ color: "var(--t2)" }}
        >
          42 项能力覆盖文案、视觉、视频、数字人与增长。把内容生产变成一条条目结清晰的流水线。
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
        <div
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]"
          style={{
            borderColor: ok ? "var(--gold-line)" : "color-mix(in srgb, var(--rose) 40%, transparent)",
            background: ok ? "var(--gold-soft)" : "var(--rose-soft)",
            color: ok ? "var(--gold)" : "var(--rose)",
          }}
        >
          <span className={`dot ${ok ? "dot-ok" : "dot-fail"}`} />
          {ok ? "AI 引擎在线" : "依赖未就绪"}
          <span style={{ opacity: 0.55 }}>
            · {health?.mode === "cloud" ? "云端模型" : "本地引擎"}
          </span>
        </div>
        <div className="mono text-[11px]" style={{ color: "var(--t3)" }}>
          今日新增 <span style={{ color: "var(--t1)" }}>{metrics?.todayRuns ?? 0}</span> 条内容
        </div>
      </div>
    </section>
  );
}

function MetricLedger({
  metrics,
  loading,
}: {
  metrics?: DashboardPayload["metrics"];
  loading: boolean;
}) {
  const cells = [
    {
      label: "本月产出",
      value: metrics?.monthRuns ?? 0,
      unit: "条",
      note: `今日 +${metrics?.todayRuns ?? 0}`,
      accent: false,
    },
    {
      label: "审核通过率",
      value: Math.round((metrics?.passRate ?? 1) * 100),
      unit: "%",
      note: "内容安全检查",
      accent: true,
    },
    {
      label: "正在运行任务",
      value: metrics?.running ?? 0,
      unit: "",
      note: metrics?.running ? "队列处理中" : "队列空闲",
      accent: false,
    },
    {
      label: "可用积分",
      value: Math.round(metrics?.remaining ?? 0),
      unit: "",
      note: `共 ${metrics?.quota ?? 0}`,
      accent: true,
    },
  ];

  return (
    <section className="card grid grid-cols-2 divide-x divide-y overflow-hidden lg:grid-cols-4 lg:divide-y-0" style={{ borderColor: "var(--line)" }}>
      {cells.map((c) => (
        <div key={c.label} className="px-4 py-3.5" style={{ borderColor: "var(--line)" }}>
          <div className="text-[10.5px]" style={{ color: "var(--t3)" }}>
            {c.label}
          </div>
          {loading ? (
            <div className="skeleton mt-2 h-6 w-16" />
          ) : (
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className="mono text-[23px] leading-none"
                style={{ color: c.accent ? "var(--gold)" : "var(--t1)" }}
              >
                {c.value}
              </span>
              {c.unit && (
                <span className="text-[11px]" style={{ color: "var(--t3)" }}>
                  {c.unit}
                </span>
              )}
            </div>
          )}
          <div className="mt-1.5 text-[10px]" style={{ color: "var(--t3)" }}>
            {c.note}
          </div>
        </div>
      ))}
    </section>
  );
}

function ChartCard({
  data,
  loading,
}: {
  data?: DashboardPayload;
  loading: boolean;
}) {
  const daily = data?.daily ?? [];
  const total = daily.reduce((a, b) => a + b.runs, 0);
  const points = daily.map((d) => ({ label: d.day, value: d.runs }));

  return (
    <section className="card p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">PRODUCTION</div>
          <h2 className="serif mt-1 text-[16px]">内容产能趋势</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="mono text-[18px] leading-none" style={{ color: "var(--t1)" }}>
              {total}
            </div>
            <div className="text-[10px]" style={{ color: "var(--t3)" }}>
              近 30 天产出
            </div>
          </div>
          <div className="seg">
            <button data-on="1" type="button">
              近 30 天
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton h-[168px] w-full" />
      ) : (
        <LineChart data={points} height={168} unit="条" />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[10.5px]" style={{ color: "var(--t3)" }}>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded" style={{ background: "var(--gold)" }} />
          每日产出
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded" style={{ background: "var(--jade)", opacity: 0.7 }} />
          7 日均线
        </span>
      </div>
    </section>
  );
}

function TrendCard({ trends }: { trends: DashboardPayload["trends"] }) {
  return (
    <section className="card flex flex-col p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div>
          <div className="eyebrow">SIGNALS</div>
          <h2 className="serif mt-1 text-[15px]">灵感队列</h2>
        </div>
        <Link href="/growth" className="text-[10.5px]" style={{ color: "var(--gold)" }}>
          刷新
        </Link>
      </div>

      <ul className="flex flex-1 flex-col">
        {trends.length === 0 && (
          <li className="py-6 text-center text-[11.5px]" style={{ color: "var(--t3)" }}>
            暂无热点数据
          </li>
        )}
        {trends.slice(0, 4).map((t, i) => (
          <li
            key={`${t.keyword}-${i}`}
            className="flex items-center gap-2.5 border-b py-2.5 last:border-0"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px]" style={{ color: "var(--t1)" }}>
                {t.keyword}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: "var(--t3)" }}>
                <span className="chip">{t.platform}</span>
                <span className="mono">热度 {Math.round(t.heat / 1000)}k</span>
              </div>
            </div>
            <span className="mono text-[11px]" style={{ color: "var(--jade)" }}>
              +{Math.round(t.growth)}%
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/tools/copy-topic"
        className="btn btn-quiet mt-3 w-full justify-center"
      >
        用它做选题
        <Icon name="arrow" size={13} />
      </Link>
    </section>
  );
}

function JobQueueCard() {
  const { data: jobs } = useJobList({ limit: 5 });
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="serif text-[15px]">生成队列</h2>
        <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
          {jobs?.filter((j) => !["succeeded", "failed", "canceled"].includes(j.status)).length ?? 0} 进行中
        </span>
      </div>
      <ul className="flex flex-col">
        {(jobs ?? []).slice(0, 4).map((j) => (
          <li key={j.id} className="flex items-center gap-2 border-b py-2 last:border-0" style={{ borderColor: "var(--line)" }}>
            <span className={`dot ${STATUS_DOT[j.status] ?? "dot-queued"}`} />
            <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: "var(--t2)" }}>
              {toolName(j.tool)}
            </span>
            <span className="mono shrink-0 text-[10px]" style={{ color: "var(--t3)" }}>
              {j.status === "running" || j.status === "queued" ? `${j.progress}%` : timeAgo(j.createdAt)}
            </span>
          </li>
        ))}
        {(!jobs || jobs.length === 0) && (
          <li className="py-5 text-center text-[11px]" style={{ color: "var(--t3)" }}>
            还没有任务
          </li>
        )}
      </ul>
    </section>
  );
}

function QuickActions() {
  const items = [
    { href: "/tools/copy-smart", label: "写文案", note: "从主题到成稿", icon: "pen" },
    { href: "/tools/image-poster", label: "出海报", note: "活动信息直出", icon: "layout" },
    { href: "/tools/video-movie", label: "做视频", note: "素材进成片出", icon: "film" },
    { href: "/tools/growth-trend", label: "追热点", note: "热度窗口内跟进", icon: "flame" },
  ];
  return (
    <section className="card p-4">
      <h2 className="serif mb-2 text-[15px]">快捷入口</h2>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="flex flex-col gap-1 rounded-[9px] border p-2.5 transition-colors hover:border-[color:var(--line-3)]"
            style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
          >
            <Icon name={it.icon} size={15} style={{ color: "var(--gold)" }} />
            <span className="text-[11.5px]" style={{ color: "var(--t1)" }}>
              {it.label}
            </span>
            <span className="text-[10px] leading-tight" style={{ color: "var(--t3)" }}>
              {it.note}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const TOOL_NAMES: Record<string, string> = {
  "copy-smart": "智能文案",
  "copy-product": "产品文案",
  "copy-topic": "爆款选题",
  "copy-persona": "人设文案",
  "image-gen": "灵感成画",
  "image-poster": "海报设计",
  "audio-tts": "音频合成",
  "video-movie": "一键大片",
  "video-mix": "超级混剪",
  "video-store": "门店引流",
  "avatar-talking": "口播数字人",
  "avatar-net": "网感视频",
  "growth-trend": "一键追爆",
  "growth-reverse": "视频反推",
  "growth-cover": "网感封面",
};

function toolName(slug: string) {
  return TOOL_NAMES[slug] ?? slug;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}
