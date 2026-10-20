"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  useBilling,
  useSubscribe,
  useToggleRenew,
  useMe,
  type BillingPayload,
  type LedgerEntry,
  type PlanPayload,
} from "@/lib/client/api";

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  grant: "发放",
  consume: "消耗",
  refund: "退回",
  expire: "过期",
  adjust: "调整",
};

const KIND_TONE: Record<LedgerEntry["kind"], string> = {
  grant: "var(--jade)",
  consume: "var(--t2)",
  refund: "var(--gold)",
  expire: "var(--rose)",
  adjust: "var(--t3)",
};

export default function BillingPage() {
  const { data, isLoading } = useBilling();
  const { data: me } = useMe();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-2">BILLING &amp; CREDITS</div>
          <h1 className="serif text-[26px] leading-tight sm:text-[30px]">订阅与积分</h1>
          <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
            订阅决定每月发放多少积分，积分决定一次任务扣多少。任务失败或取消会自动退回。
          </p>
        </div>
        <div className="mono text-[10.5px]" style={{ color: "var(--t3)" }}>
          {me?.org?.name ?? "—"} · {me?.user?.email ?? ""}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[11.5px]"
          style={{
            borderColor:
              notice.tone === "ok"
                ? "var(--gold-line)"
                : "color-mix(in srgb, var(--rose) 40%, transparent)",
            background: notice.tone === "ok" ? "var(--gold-soft)" : "var(--rose-soft)",
            color: notice.tone === "ok" ? "var(--gold)" : "var(--rose)",
          }}
        >
          <Icon name={notice.tone === "ok" ? "check" : "alert"} size={13} />
          {notice.text}
        </div>
      )}

      {isLoading || !data ? (
        <div className="skeleton h-[220px] w-full" />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <CreditsCard data={data} />
            <PlanCard data={data} onNotice={setNotice} />
          </section>

          <PlanGrid data={data} onNotice={setNotice} />

          <LedgerTable entries={data.ledger} />
        </>
      )}
    </div>
  );
}

function CreditsCard({ data }: { data: BillingPayload }) {
  const monthly = data.plan?.monthlyCredits ?? 0;
  const balance = data.credits.balance;
  const pct = monthly > 0 ? Math.min(100, Math.round((balance / monthly) * 100)) : 0;

  return (
    <section className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">BALANCE</div>
          <h2 className="serif mt-1 text-[16px]">可用积分</h2>
        </div>
        <span className="chip">{data.plan?.name ?? "未订阅"}</span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="mono text-[38px] leading-none" style={{ color: "var(--gold)" }}>
          {balance.toLocaleString("zh-CN")}
        </span>
        <span className="mb-1 text-[11.5px]" style={{ color: "var(--t3)" }}>
          / 每月 {monthly.toLocaleString("zh-CN")} 积分
        </span>
      </div>

      <div
        className="mt-3 h-[6px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-3)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(pct, 1.5)}%`,
            background: pct < 15 ? "var(--rose)" : "linear-gradient(90deg,var(--gold),var(--gold-2))",
          }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        {[
          ["本月发放", data.credits.grantedThisMonth, "var(--jade)"],
          ["本月消耗", data.credits.consumedThisMonth, "var(--t1)"],
          ["自动退回", data.credits.refundedThisMonth, "var(--gold)"],
        ].map(([label, value, color]) => (
          <div key={String(label)}>
            <dt className="text-[10.5px]" style={{ color: "var(--t3)" }}>
              {label}
            </dt>
            <dd className="mono mt-1 text-[16px]" style={{ color: String(color) }}>
              {Number(value).toLocaleString("zh-CN")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PlanCard({
  data,
  onNotice,
}: {
  data: BillingPayload;
  onNotice: (n: { tone: "ok" | "err"; text: string } | null) => void;
}) {
  const toggle = useToggleRenew();
  const sub = data.subscription;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const onToggle = async () => {
    if (!sub) return;
    try {
      await toggle.mutateAsync(sub.autoRenew ? "cancel" : "resume");
      onNotice({
        tone: "ok",
        text: sub.autoRenew ? "已关闭自动续订，当前周期结束后停止扣费" : "已恢复自动续订",
      });
    } catch {
      onNotice({ tone: "err", text: "操作失败，请稍后再试" });
    }
  };

  return (
    <section className="card p-4 lg:p-5">
      <div className="eyebrow">CURRENT PLAN</div>
      <h2 className="serif mt-1 text-[16px]">当前订阅</h2>

      {sub ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="serif text-[22px]">{data.plan?.name}</span>
            <span className="mono text-[12px]" style={{ color: "var(--t3)" }}>
              ¥{data.plan?.priceCny ?? 0} / 月
            </span>
          </div>
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--t3)" }}>
            {data.plan?.tagline}
          </p>

          <dl className="mt-4 flex flex-col gap-2 text-[11.5px]">
            <Row label="当前周期" value={`${fmtDate(sub.periodStart)} — ${fmtDate(sub.periodEnd)}`} />
            <Row label="席位数" value={`${sub.seats} 个`} />
            <Row
              label="自动续订"
              value={sub.autoRenew ? "开启" : "已关闭"}
              tone={sub.autoRenew ? "var(--jade)" : "var(--rose)"}
            />
            <Row label="最近订单" value={sub.orderNo ?? "—"} mono />
          </dl>

          <button
            type="button"
            onClick={onToggle}
            disabled={toggle.isPending}
            className="btn btn-quiet mt-4 w-full justify-center"
          >
            {toggle.isPending ? (
              <>
                <span className="spinner" /> 处理中…
              </>
            ) : sub.autoRenew ? (
              "关闭自动续订"
            ) : (
              "恢复自动续订"
            )}
          </button>
        </>
      ) : (
        <p className="mt-3 text-[12px]" style={{ color: "var(--t3)" }}>
          还没有订阅，选择一个套餐即可开始。
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ color: "var(--t3)" }}>{label}</dt>
      <dd className={mono ? "mono text-[10.5px]" : ""} style={{ color: tone ?? "var(--t1)" }}>
        {value}
      </dd>
    </div>
  );
}

function PlanGrid({
  data,
  onNotice,
}: {
  data: BillingPayload;
  onNotice: (n: { tone: "ok" | "err"; text: string } | null) => void;
}) {
  const subscribe = useSubscribe();
  const [pending, setPending] = useState<string | null>(null);
  const current = data.subscription?.planCode;

  const onPick = async (plan: PlanPayload) => {
    if (plan.code === current) return;
    setPending(plan.code);
    onNotice(null);
    try {
      const res = await subscribe.mutateAsync({ planCode: plan.code, months: 1 });
      onNotice({
        tone: "ok",
        text:
          res.grantedCredits > 0
            ? `已开通「${res.plan.name}」，本月发放 ${res.grantedCredits} 积分（订单 ${res.orderNo}）`
            : `已切换到「${res.plan.name}」，本月额度已发放过，下月按新套餐发放`,
      });
    } catch (err) {
      onNotice({ tone: "err", text: (err as Error).message || "开通失败" });
    } finally {
      setPending(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="serif text-[16px]">套餐</h2>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--t3)" }}>
            切换套餐立即生效，本期积分按新套餐重新发放
          </p>
        </div>
        <span className="mono hidden text-[10px] sm:block" style={{ color: "var(--t3)" }}>
          演示环境走 mock 支付通道，接入后替换为微信/支付宝
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p) => {
          const active = p.code === current;
          return (
            <article
              key={p.code}
              className="card flex flex-col p-4"
              style={{
                borderColor: active ? "var(--gold-line)" : "var(--line)",
                background: active ? "var(--gold-soft)" : "var(--surface)",
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="serif text-[15px]">{p.name}</h3>
                {active && <span className="chip chip-jade">当前</span>}
              </div>
              <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--t3)" }}>
                {p.tagline}
              </p>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="mono text-[22px]" style={{ color: active ? "var(--gold)" : "var(--t1)" }}>
                  ¥{p.priceCny}
                </span>
                <span className="text-[10.5px]" style={{ color: "var(--t3)" }}>
                  / 月
                </span>
              </div>
              <div className="mono mt-1 text-[10.5px]" style={{ color: "var(--t2)" }}>
                {p.monthlyCredits.toLocaleString("zh-CN")} 积分 · {p.seats} 席位
              </div>

              <ul className="mt-3 flex flex-1 flex-col gap-1.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--t2)" }}>
                    <Icon
                      name="check"
                      size={11}
                      style={{ color: "var(--gold)", marginTop: 3, flexShrink: 0 }}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={active || pending !== null}
                onClick={() => onPick(p)}
                className={`btn mt-4 w-full justify-center ${active ? "btn-quiet" : "btn-primary"}`}
              >
                {active ? (
                  "当前套餐"
                ) : pending === p.code ? (
                  <>
                    <span className="spinner" /> 开通中…
                  </>
                ) : (
                  <>开通 {p.name}</>
                )}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="serif text-[15px]">积分明细</h2>
          <p className="mt-0.5 text-[10.5px]" style={{ color: "var(--t3)" }}>
            余额 = 每笔变动累加，任何一条都能回溯来源
          </p>
        </div>
        <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
          最近 {entries.length} 条
        </span>
      </div>

      {/* 桌面：表格 */}
      <div className="hidden overflow-x-auto border-t md:block" style={{ borderColor: "var(--line)" }}>
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
              {["时间", "类型", "说明", "变动", "余额"].map((h, i) => (
                <th
                  key={h}
                  className="px-3 py-2 font-normal"
                  style={{ textAlign: i >= 3 ? "right" : "left" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center" style={{ color: "var(--t3)" }}>
                  还没有积分记录
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td className="mono px-3 py-2 whitespace-nowrap" style={{ color: "var(--t3)" }}>
                  {fmt(e.created_at)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: KIND_TONE[e.kind] }}>
                  {KIND_LABEL[e.kind] ?? e.kind}
                </td>
                <td className="px-3 py-2" style={{ color: "var(--t2)" }}>
                  {e.reason}
                </td>
                <td
                  className="mono px-3 py-2 text-right whitespace-nowrap"
                  style={{ color: e.delta > 0 ? "var(--jade)" : "var(--t1)" }}
                >
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </td>
                <td className="mono px-3 py-2 text-right" style={{ color: "var(--t3)" }}>
                  {e.balance_after}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 移动端：列表 */}
      <ul className="border-t md:hidden" style={{ borderColor: "var(--line)" }}>
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px]" style={{ color: "var(--t1)" }}>
                {e.reason}
              </div>
              <div className="mono mt-0.5 text-[10px]" style={{ color: "var(--t3)" }}>
                {fmt(e.created_at)} · {KIND_LABEL[e.kind]}
              </div>
            </div>
            <div className="text-right">
              <div
                className="mono text-[13px]"
                style={{ color: e.delta > 0 ? "var(--jade)" : "var(--t1)" }}
              >
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </div>
              <div className="mono text-[9.5px]" style={{ color: "var(--t3)" }}>
                余 {e.balance_after}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
