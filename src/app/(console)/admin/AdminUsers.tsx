"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  ApiError,
  useAdjustCredits,
  useAdminOverview,
  useAdminUsers,
  useChangePlan,
  useManualTransfer,
  type AdminUserRow,
} from "@/lib/client/api";

const nf = new Intl.NumberFormat("zh-CN");

export function AdminUsers() {
  const [keyword, setKeyword] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading } = useAdminUsers(keyword);
  const { data: overview } = useAdminOverview();
  const { data: plansData } = useManualTransfer();
  const plans = plansData?.plans ?? [];

  const stats = overview?.stats;

  return (
    <div className="flex flex-col gap-4">
      {/* 概览 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["注册用户", stats ? nf.format(stats.users) : "—", `${stats?.verifiedUsers ?? 0} 已验证`],
          ["工作空间", stats ? nf.format(stats.orgs) : "—", "按租户隔离"],
          [
            "待审转账",
            stats ? nf.format(stats.pendingPayments) : "—",
            stats ? `¥${stats.pendingAmount.toFixed(2)}` : "",
          ],
          [
            "本月转账收入",
            stats ? `¥${stats.gmvThisMonth.toFixed(2)}` : "—",
            stats ? `今日发分 ${nf.format(stats.creditsToday)}` : "",
          ],
        ].map(([label, value, sub]) => (
          <div
            key={label}
            className="rounded-[10px] border p-3"
            style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
          >
            <div className="text-[10.5px]" style={{ color: "var(--t3)" }}>
              {label}
            </div>
            <div className="mono mt-1 text-[17px]" style={{ color: "var(--t1)" }}>
              {value}
            </div>
            {sub && (
              <div className="mono mt-0.5 text-[9.5px]" style={{ color: "var(--t3)" }}>
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 搜索 */}
      <section className="card p-4 lg:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="serif text-[15px]">用户列表</h2>
          <div className="flex items-center gap-2">
            <input
              className="input h-8 w-[220px] text-[12px]"
              placeholder="搜邮箱 / 称呼 / 空间名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {data ? `${data.total} 条` : "—"}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
            <thead>
              <tr style={{ color: "var(--t3)" }}>
                <th className="pb-2 text-left font-normal">用户</th>
                <th className="pb-2 text-left font-normal">空间</th>
                <th className="pb-2 text-left font-normal">套餐</th>
                <th className="pb-2 text-right font-normal">余额</th>
                <th className="pb-2 text-right font-normal">本月消耗</th>
                <th className="pb-2 text-left font-normal">状态</th>
                <th className="pb-2 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((u) => (
                <UserRow
                  key={u.userId}
                  user={u}
                  plans={plans}
                  open={openId === u.userId}
                  onToggle={() => setOpenId(openId === u.userId ? null : u.userId)}
                />
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={7} className="py-4 text-center" style={{ color: "var(--t3)" }}>
                    加载中…
                  </td>
                </tr>
              )}
              {!isLoading && !data?.rows.length && (
                <tr>
                  <td colSpan={7} className="py-4 text-center" style={{ color: "var(--t3)" }}>
                    没有匹配的用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
          余额来自积分账本的 <code className="mono">sum(delta)</code>，不存冗余字段；调额度会写一条{" "}
          <code className="mono">adjust/grant</code> 流水并记审计。套餐的月度积分按自然月发放，
          同月内换套餐只补差额（已发已达新套餐额度就不再发），要额外赠送请填「附加积分」。
        </p>
      </section>
    </div>
  );
}

function UserRow({
  user,
  plans,
  open,
  onToggle,
}: {
  user: AdminUserRow;
  plans: Array<{ code: string; name: string; monthlyCredits: number }>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--line)" }}>
        <td className="py-2.5">
          <div className="flex items-center gap-1.5">
            <span style={{ color: "var(--t1)" }}>{user.name}</span>
            {user.isAdmin && (
              <span className="chip" style={{ color: "var(--gold)", fontSize: 9, padding: "0 5px" }}>
                ADMIN
              </span>
            )}
          </div>
          <div className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {user.email}
          </div>
        </td>
        <td className="py-2.5" style={{ color: "var(--t2)" }}>
          {user.orgName}
        </td>
        <td className="py-2.5">
          <span className="chip" style={{ fontSize: 9.5, padding: "0 6px" }}>
            {user.planName}
          </span>
          {user.periodEnd && (
            <div className="mono mt-0.5 text-[9.5px]" style={{ color: "var(--t3)" }}>
              至 {new Date(user.periodEnd).toLocaleDateString("zh-CN")}
            </div>
          )}
        </td>
        <td className="mono py-2.5 text-right" style={{ color: "var(--gold)" }}>
          {nf.format(user.balance)}
        </td>
        <td className="mono py-2.5 text-right" style={{ color: "var(--t2)" }}>
          {nf.format(user.consumedThisMonth)}
        </td>
        <td className="py-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px]">
            <span className={`dot ${user.verified ? "dot-ok" : "dot-queued"}`} />
            <span style={{ color: user.verified ? "var(--jade)" : "var(--t3)" }}>
              {user.verified ? "已验证" : "待验证"}
            </span>
          </div>
          {user.pendingPayments > 0 && (
            <div className="mono mt-0.5 text-[9.5px]" style={{ color: "var(--gold)" }}>
              {user.pendingPayments} 笔待审转账
            </div>
          )}
        </td>
        <td className="py-2.5 text-right">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
            {open ? "收起" : "调额度 / 改套餐"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-3">
            <ActionPanel user={user} plans={plans} />
          </td>
        </tr>
      )}
    </>
  );
}

function ActionPanel({
  user,
  plans,
}: {
  user: AdminUserRow;
  plans: Array<{ code: string; name: string; monthlyCredits: number }>;
}) {
  const adjust = useAdjustCredits();
  const changePlan = useChangePlan();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [planCode, setPlanCode] = useState(user.planCode);
  const [months, setMonths] = useState("1");
  const [bonus, setBonus] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "操作失败" });
    }
  };

  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-[10px] border p-3 lg:grid-cols-2"
      style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
    >
      {/* 调额度 */}
      <div className="flex flex-col gap-2">
        <div className="text-[11px]" style={{ color: "var(--t2)" }}>
          调整积分（正数发放，负数扣减）
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            className="input mono h-8 w-[110px] text-[12px]"
            placeholder="±积分"
            value={delta}
            onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ""))}
            inputMode="numeric"
          />
          {[100, 1000, 6000, -100].map((v) => (
            <button
              key={v}
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setDelta(String(v))}
            >
              {v > 0 ? `+${v}` : v}
            </button>
          ))}
        </div>
        <input
          className="input h-8 text-[12px]"
          placeholder="原因（会写进流水与审计）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm justify-center"
          disabled={adjust.isPending || !delta || !reason.trim()}
          onClick={() =>
            void run(async () => {
              const r = await adjust.mutateAsync({
                userId: user.userId,
                delta: Number(delta),
                reason: reason.trim(),
              });
              setDelta("");
              setReason("");
              return `已调整 ${r.delta > 0 ? "+" : ""}${r.delta}，当前余额 ${nf.format(r.balance)}`;
            })
          }
        >
          {adjust.isPending ? "提交中…" : "提交调整"}
        </button>
      </div>

      {/* 改套餐 */}
      <div className="flex flex-col gap-2">
        <div className="text-[11px]" style={{ color: "var(--t2)" }}>
          设置套餐（立即生效，旧订阅作废）
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            className="input h-8 text-[12px]"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}（每月 {nf.format(p.monthlyCredits)}）
              </option>
            ))}
          </select>
          <input
            className="input mono h-8 w-[70px] text-[12px]"
            value={months}
            onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="月数"
            inputMode="numeric"
          />
          <input
            className="input mono h-8 w-[100px] text-[12px]"
            placeholder="附加积分"
            value={bonus}
            onChange={(e) => setBonus(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm justify-center"
          disabled={changePlan.isPending || !planCode}
          onClick={() =>
            void run(async () => {
              const r = await changePlan.mutateAsync({
                userId: user.userId,
                planCode,
                months: Number(months || 1),
                bonusCredits: Number(bonus || 0),
                reason: reason.trim() || "后台手动调整",
              });
              setBonus("");
              return `已设为 ${r.planCode}，本月发放 ${r.granted}，附加 ${r.bonus}`;
            })
          }
        >
          {changePlan.isPending ? "提交中…" : "应用套餐"}
        </button>
      </div>

      {msg && (
        <div
          className="lg:col-span-2 flex items-start gap-1.5 text-[11px]"
          style={{ color: msg.tone === "ok" ? "var(--jade)" : "var(--rose)" }}
        >
          <Icon name={msg.tone === "ok" ? "check" : "alert"} size={13} />
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
