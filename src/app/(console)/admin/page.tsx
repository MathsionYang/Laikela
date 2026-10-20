"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useHealth, useMe, useModels, useTools, useUsage } from "@/lib/client/api";
import { AdminUsers } from "./AdminUsers";
import { AdminPayments } from "./AdminPayments";

type Tab = "runtime" | "users" | "payments";

export default function AdminPage() {
  const { data: health, refetch, isFetching } = useHealth();
  const { data: tools } = useTools();
  const { data: usage } = useUsage();
  const { data: models } = useModels();
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>("runtime");

  // 平台管理员才能看：这里做一层前端提示，真正的拦截在每一个 /api/admin/* 里
  if (me && me.user && !me.user.isAdmin) {
    return (
      <div className="card p-6">
        <div className="eyebrow mb-2">FORBIDDEN</div>
        <h1 className="serif text-[22px]">需要平台管理员权限</h1>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
          这个页面跨租户，只有平台管理员能打开。把账号邮箱加进{" "}
          <code className="mono">ADMIN_EMAILS</code> 环境变量并重启，或直接在库里把{" "}
          <code className="mono">users.is_admin</code> 置为 true。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="eyebrow">ADMIN</div>
          <h1 className="serif text-[26px] leading-tight sm:text-[30px]">管理台</h1>
          <p className="text-[12px]" style={{ color: "var(--t3)" }}>
            用户与额度、转账审核、依赖状态。所有配置都走环境变量，不写死在代码里。
          </p>
        </div>
        {tab === "runtime" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <Icon name="refresh" size={12} />
            {isFetching ? "检测中…" : "重新检测"}
          </button>
        )}
      </div>

      <div className="seg w-full max-w-[420px]" role="tablist" aria-label="管理台分区">
        {([
          ["runtime", "运行状态"],
          ["users", "用户与额度"],
          ["payments", "转账审核"],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-on={tab === key ? "1" : undefined}
            onClick={() => setTab(key)}
            className="flex-1"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "users" && <AdminUsers />}
      {tab === "payments" && <AdminPayments />}

      {tab === "runtime" && (
        <>
      {/* 依赖 */}
      <section className="card p-4 lg:p-5">
        <h2 className="serif mb-3 text-[15px]">运行依赖</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {(health?.checks ?? []).map((c) => (
            <div
              key={c.id}
              className="rounded-[10px] border p-3"
              style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
            >
              <div className="flex items-center gap-2">
                <span className={`dot ${c.ok ? "dot-ok" : "dot-fail"}`} />
                <span className="text-[12px]" style={{ color: "var(--t1)" }}>
                  {c.label}
                </span>
                <span
                  className="mono ml-auto text-[9.5px]"
                  style={{ color: c.ok ? "var(--jade)" : "var(--rose)" }}
                >
                  {c.ok ? "OK" : "DOWN"}
                </span>
              </div>
              <p className="mono mt-1.5 break-all text-[10px] leading-relaxed" style={{ color: "var(--t3)" }}>
                {c.detail}
              </p>
            </div>
          ))}
          {!health && <div className="skeleton h-20 sm:col-span-3" />}
        </div>
      </section>

      {/* Provider */}
      <section className="card p-4 lg:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="serif text-[15px]">模型路由</h2>
          <div className="flex items-center gap-3">
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {models ? `可用 ${models.models.filter((m) => m.usable).length}/${models.models.length}` : "—"}
            </span>
            <Link href="/settings/models" className="mono text-[10.5px] underline" style={{ color: "var(--gold)" }}>
              模型接入 →
            </Link>
          </div>
        </div>
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--line)" }}>
          {(health?.providers ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2.5">
              <span className={`dot ${p.available ? "dot-ok" : "dot-queued"}`} />
              <span className="text-[12px]" style={{ color: "var(--t1)" }}>
                {p.label}
              </span>
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                {p.id}
              </span>
              <span
                className="chip ml-auto"
                style={
                  p.available
                    ? { color: "var(--jade)", borderColor: "color-mix(in srgb, var(--jade) 34%, transparent)" }
                    : undefined
                }
              >
                {p.local ? "兜底" : p.available ? "已配置" : "未配置"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
          平台 Key 走 <code className="mono">DEEPSEEK_API_KEY</code> / <code className="mono">DOUBAO_API_KEY</code>
          （改完需重启）；租户也可以在自己空间里填 BYOK，优先级高于平台 Key，无需重启即刻生效。
          两者都没有时由本地引擎兜底，输出结构完全一致。
        </p>
      </section>

      {/* 工具开关 */}
      <section className="card p-4 lg:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="serif text-[15px]">工具目录</h2>
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {tools?.tools.length ?? 0} 个
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {(tools?.tools ?? []).map((t) => (
            <div
              key={t.slug}
              className="flex items-center gap-2 rounded-[8px] border px-2.5 py-2"
              style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
            >
              <Icon name={t.icon} size={13} style={{ color: "var(--gold)" }} />
              <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: "var(--t1)" }}>
                {t.name}
              </span>
              <span className="mono text-[9.5px]" style={{ color: "var(--t3)" }}>
                {t.runs} 次
              </span>
              <span
                className="h-3.5 w-6 rounded-full"
                style={{ background: t.enabled ? "var(--gold)" : "var(--line-2)", position: "relative" }}
                aria-hidden="true"
              >
                <span
                  className="absolute top-[2px] h-[10px] w-[10px] rounded-full"
                  style={{
                    background: "var(--page)",
                    left: t.enabled ? 12 : 2,
                    transition: "left .16s",
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10.5px]" style={{ color: "var(--t3)" }}>
          开关状态存在 <code className="mono">tool_definitions.enabled</code>，接口层会据此过滤；当前版本仅展示，不做写操作。
        </p>
      </section>

      {/* 用量 */}
      <section className="card p-4 lg:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="serif text-[15px]">本月用量</h2>
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            记录在 usage_records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[11.5px]">
            <thead>
              <tr style={{ color: "var(--t3)" }}>
                <th className="pb-2 text-left font-normal">供应商</th>
                <th className="pb-2 text-right font-normal">调用次数</th>
                <th className="pb-2 text-right font-normal">费用</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.byProvider ?? []).map((p) => (
                <tr key={p.provider} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="mono py-2" style={{ color: "var(--t1)" }}>
                    {p.provider}
                  </td>
                  <td className="mono py-2 text-right" style={{ color: "var(--t2)" }}>
                    {p.count}
                  </td>
                  <td className="mono py-2 text-right" style={{ color: "var(--gold)" }}>
                    ¥{p.cost.toFixed(4)}
                  </td>
                </tr>
              ))}
              {!usage?.byProvider.length && (
                <tr>
                  <td colSpan={3} className="py-3 text-center" style={{ color: "var(--t3)" }}>
                    本月还没有用量记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}
    </div>
  );
}
