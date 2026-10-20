"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  ApiError,
  useCancelTransfer,
  useManualTransfer,
  useSubmitTransfer,
  useSubscribe,
  type ManualClaim,
} from "@/lib/client/api";

const CHANNELS = [
  ["wechat", "微信"],
  ["alipay", "支付宝"],
  ["bank", "银行"],
] as const;

const STATUS: Record<ManualClaim["status"], { label: string; color: string }> = {
  pending: { label: "待审核", color: "var(--gold)" },
  approved: { label: "已到账", color: "var(--jade)" },
  rejected: { label: "已驳回", color: "var(--rose)" },
  canceled: { label: "已撤销", color: "var(--t3)" },
};

const nf = new Intl.NumberFormat("zh-CN");

/**
 * 人工转账开通道。
 * 个人主体拿不到微信/支付宝的收款 API（见 docs/PAYMENT-ACCESS.md），
 * 在拿到个体户资质前，这条「转账 → 申报 → 管理员核对 → 发额度」的链路就是正式通道，
 * 不是临时补丁：它有状态机、有对账依据、有审计。
 */
export function ManualTransfer() {
  const { data, isLoading } = useManualTransfer();
  const submit = useSubmitTransfer();
  const cancel = useCancelTransfer();
  const subscribe = useSubscribe();

  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<"wechat" | "alipay" | "bank">("wechat");
  const [planCode, setPlanCode] = useState("");
  const [months, setMonths] = useState("1");
  const [payerName, setPayerName] = useState("");
  const [transferNo, setTransferNo] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const plans = data?.plans ?? [];
  const payTo = data?.payTo;
  const claims = data?.claims ?? [];

  const quickPick = (code: string) => {
    setPlanCode(code);
    const plan = plans.find((p) => p.code === code);
    if (plan) setAmount(String(plan.priceCny));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await submit.mutateAsync({
        amountCny: Number(amount),
        channel,
        planCode: planCode || undefined,
        months: Number(months || 1),
        payerName: payerName || undefined,
        transferNo: transferNo || undefined,
        note: note || undefined,
      });
      setTransferNo("");
      setNote("");
      setMsg({
        tone: "ok",
        text: `已提交（单号 ${res.claim.id}）。管理员核对流水后会自动到账，通常 1 个工作日内。`,
      });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "提交失败" });
    }
  };

  return (
    <section className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="serif text-[15px]">人工转账开通</h2>
        <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
          在线支付接入中 · 当前走人工核对
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
        {payTo?.note ?? "转账后提交下方的转账信息，管理员核对到账后为你发放积分/开通套餐。"}
      </p>

      {/* 收款信息 */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["收款人", payTo?.payee],
          ["微信", payTo?.wechat],
          ["支付宝", payTo?.alipay],
          ["银行账户", payTo?.bank],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[9px] border px-2.5 py-2"
            style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
          >
            <div className="text-[10px]" style={{ color: "var(--t3)" }}>
              {label}
            </div>
            <div className="mono mt-0.5 break-all text-[11.5px]" style={{ color: value ? "var(--t1)" : "var(--t3)" }}>
              {value || (payTo?.contact ? `联系 ${payTo.contact}` : "联系管理员获取")}
            </div>
          </div>
        ))}
      </div>

      {/* 快捷选套餐 */}
      {plans.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px]" style={{ color: "var(--t3)" }}>
            按套餐填：
          </span>
          {plans.map((p) => (
            <button
              key={p.code}
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => quickPick(p.code)}
            >
              {p.name} ¥{p.priceCny}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <label className="field">
          <span className="field-label">
            转账金额（元）<span className="req">必填</span>
          </span>
          <input
            className="input mono h-9 text-[12.5px]"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="99"
            inputMode="decimal"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">转账方式</span>
          <select
            className="input h-9 text-[12.5px]"
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            {CHANNELS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">要开通的套餐</span>
          <select
            className="input h-9 text-[12.5px]"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
          >
            <option value="">仅充值积分（不改套餐）</option>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} · ¥{p.priceCny}/月
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">月数</span>
          <input
            className="input mono h-9 text-[12.5px]"
            value={months}
            onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
          />
        </label>

        <label className="field">
          <span className="field-label">付款人姓名（可选）</span>
          <input
            className="input h-9 text-[12.5px]"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="转账卡片上的名字"
          />
        </label>

        <label className="field">
          <span className="field-label">转账单号 / 流水号（建议填）</span>
          <input
            className="input mono h-9 text-[12.5px]"
            value={transferNo}
            onChange={(e) => setTransferNo(e.target.value)}
            placeholder="便于对账，重复单号会被拒绝"
          />
        </label>

        <label className="field sm:col-span-2">
          <span className="field-label">备注（可选）</span>
          <input
            className="input h-9 text-[12.5px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：已按备注邮箱转账，请核对"
          />
        </label>

        <div className="sm:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submit.isPending || !amount}
          >
            {submit.isPending ? "提交中…" : "提交转账申报"}
            <Icon name="arrow" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={subscribe.isPending}
            title="演示环境直接开通，用于验证套餐与积分链路"
            onClick={async () => {
              const code = planCode || "creator";
              setMsg(null);
              try {
                const r = await subscribe.mutateAsync({ planCode: code, months: 1 });
                setMsg({
                  tone: "ok",
                  text: `演示通道已直接开通 ${r.plan.name}，发放 ${r.grantedCredits} 积分（无需真实付款）。`,
                });
              } catch (err) {
                setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "开通失败" });
              }
            }}
          >
            演示：跳过付款直接开通
          </button>
          {msg && (
            <span
              className="flex items-start gap-1.5 text-[11px]"
              style={{ color: msg.tone === "ok" ? "var(--jade)" : "var(--rose)" }}
            >
              <Icon name={msg.tone === "ok" ? "check" : "alert"} size={13} />
              {msg.text}
            </span>
          )}
        </div>
      </form>

      {/* 我的申报 */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[12px]" style={{ color: "var(--t2)" }}>
            我的转账记录
          </h3>
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {isLoading ? "加载中…" : `${claims.length} 条`}
          </span>
        </div>
        {claims.length === 0 && !isLoading && (
          <div className="text-[11px]" style={{ color: "var(--t3)" }}>
            还没有提交过转账申报。
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {claims.map((c) => {
            const st = STATUS[c.status];
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-[8px] border px-2.5 py-2"
                style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
              >
                <span className="mono text-[12px]" style={{ color: "var(--gold)" }}>
                  ¥{Number(c.amount_cny).toFixed(2)}
                </span>
                <span className="chip" style={{ fontSize: 9, color: st.color, borderColor: st.color }}>
                  {st.label}
                </span>
                <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                  {new Date(c.created_at).toLocaleString("zh-CN")}
                </span>
                {c.plan_code && (
                  <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                    {c.plan_code} × {c.months} 月
                  </span>
                )}
                {c.status === "approved" && (
                  <span className="mono text-[10px]" style={{ color: "var(--jade)" }}>
                    +{nf.format(c.credits_granted)} 积分
                  </span>
                )}
                {c.review_note && (
                  <span className="text-[10px]" style={{ color: "var(--t3)" }}>
                    {c.review_note}
                  </span>
                )}
                {c.status === "pending" && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm ml-auto"
                    disabled={cancel.isPending}
                    onClick={() => void cancel.mutateAsync(c.id)}
                  >
                    撤销
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
