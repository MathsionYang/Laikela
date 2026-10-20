"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  ApiError,
  useAdminPayments,
  useManualTransfer,
  useReviewPayment,
  type AdminClaimRow,
} from "@/lib/client/api";

const STATUS_LIST = [
  ["pending", "待审"],
  ["approved", "已通过"],
  ["rejected", "已驳回"],
  ["all", "全部"],
] as const;

const CHANNEL_LABEL: Record<string, string> = {
  wechat: "微信转账",
  alipay: "支付宝转账",
  bank: "银行转账",
};

export function AdminPayments() {
  const [status, setStatus] = useState<string>("pending");
  const { data, isLoading } = useAdminPayments(status);
  const rows = data?.rows ?? [];
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg" role="tablist" aria-label="审核状态">
          {STATUS_LIST.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={status === key}
              data-on={status === key ? "1" : undefined}
              onClick={() => setStatus(key)}
              className="px-3"
            >
              {label}
            </button>
          ))}
        </div>
        <span className="mono text-[10.5px]" style={{ color: "var(--t3)" }}>
          {isLoading ? "加载中…" : `${rows.length} 条`}
          {status !== "pending" && pendingCount > 0 ? " · 本页含待审" : ""}
        </span>
      </div>

      {!isLoading && rows.length === 0 && (
        <div className="card p-6 text-center text-[12px]" style={{ color: "var(--t3)" }}>
          没有这个状态的转账记录。
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <ClaimCard key={row.id} claim={row} />
        ))}
      </div>

      <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
        审核是条件更新（<code className="mono">where status=&apos;pending&apos;</code>），两个人同时点「通过」也只会发一次额度；
        入账用带单号的幂等键，重复提交不会重复加积分。所有操作写入{" "}
        <code className="mono">admin_audit_log</code>。
      </p>
    </div>
  );
}

function ClaimCard({ claim }: { claim: AdminClaimRow }) {
  const { data: plansData } = useManualTransfer();
  const plans = plansData?.plans ?? [];
  const review = useReviewPayment();

  const [planCode, setPlanCode] = useState(claim.plan_code ?? "");
  const [months, setMonths] = useState(String(claim.months ?? 1));
  const [bonus, setBonus] = useState("0");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const pending = claim.status === "pending";
  const amount = Number(claim.amount_cny);

  const act = async (action: "approve" | "reject") => {
    setMsg(null);
    try {
      const r = await review.mutateAsync({
        id: claim.id,
        action,
        planCode: planCode || null,
        months: Number(months || 1),
        bonusCredits: Number(bonus || 0),
        note: note.trim() || undefined,
      });
      setMsg({
        tone: "ok",
        text: action === "approve" ? `已通过，发放 ${r.creditsGranted} 积分` : "已驳回",
      });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "操作失败" });
    }
  };

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-[15px]" style={{ color: "var(--gold)" }}>
              ¥{amount.toFixed(2)}
            </span>
            <span className="chip" style={{ fontSize: 9.5 }}>
              {CHANNEL_LABEL[claim.channel] ?? claim.channel}
            </span>
            <StatusChip status={claim.status} />
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {new Date(claim.created_at).toLocaleString("zh-CN")}
            </span>
          </div>
          <div className="mt-1.5 text-[12px]" style={{ color: "var(--t1)" }}>
            {claim.user_name} · <span className="mono">{claim.user_email}</span>
          </div>
          <div className="mono mt-0.5 text-[10.5px]" style={{ color: "var(--t3)" }}>
            {claim.org_name}
            {claim.plan_code ? ` · 申报套餐 ${claim.plan_code} × ${claim.months} 月` : " · 仅充值积分"}
            {claim.transfer_no ? ` · 单号 ${claim.transfer_no}` : ""}
            {claim.payer_name ? ` · 付款人 ${claim.payer_name}` : ""}
          </div>
          {claim.note && (
            <div className="mt-1 text-[11px]" style={{ color: "var(--t2)" }}>
              备注：{claim.note}
            </div>
          )}
          {claim.review_note && (
            <div className="mt-1 text-[11px]" style={{ color: "var(--t3)" }}>
              审核备注：{claim.review_note}
            </div>
          )}
        </div>
        {!pending && (
          <div className="mono text-right text-[10.5px]" style={{ color: "var(--t3)" }}>
            {claim.reviewed_by && <div>by {claim.reviewed_by}</div>}
            {claim.reviewed_at && <div>{new Date(claim.reviewed_at).toLocaleString("zh-CN")}</div>}
            <div style={{ color: "var(--jade)" }}>发放 {claim.credits_granted} 积分</div>
          </div>
        )}
      </div>

      {pending && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <label className="field w-[190px]">
            <span className="field-label">套餐</span>
            <select
              className="input h-8 text-[12px]"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
            >
              <option value="">不改套餐</option>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}（每月 {p.monthlyCredits}）
                </option>
              ))}
            </select>
          </label>
          <label className="field w-[70px]">
            <span className="field-label">月数</span>
            <input
              className="input mono h-8 text-[12px]"
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
            />
          </label>
          <label className="field w-[100px]">
            <span className="field-label">附加积分</span>
            <input
              className="input mono h-8 text-[12px]"
              value={bonus}
              onChange={(e) => setBonus(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
            />
          </label>
          <label className="field w-[180px]">
            <span className="field-label">审核备注</span>
            <input
              className="input h-8 text-[12px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：已核对流水"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={review.isPending}
              onClick={() => void act("approve")}
            >
              <Icon name="check" size={13} />
              通过并入账
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={review.isPending}
              onClick={() => void act("reject")}
            >
              驳回
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div
          className="mt-2 flex items-start gap-1.5 text-[11px]"
          style={{ color: msg.tone === "ok" ? "var(--jade)" : "var(--rose)" }}
        >
          <Icon name={msg.tone === "ok" ? "check" : "alert"} size={13} />
          <span>{msg.text}</span>
        </div>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "待审", color: "var(--gold)" },
    approved: { label: "已通过", color: "var(--jade)" },
    rejected: { label: "已驳回", color: "var(--rose)" },
    canceled: { label: "已撤销", color: "var(--t3)" },
  };
  const it = map[status] ?? { label: status, color: "var(--t3)" };
  return (
    <span className="chip" style={{ fontSize: 9.5, color: it.color, borderColor: it.color }}>
      {it.label}
    </span>
  );
}
