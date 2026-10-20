"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ApiError, apiPost } from "@/lib/client/api";

type Mode = "login" | "register" | "verify";

const DEMO_EMAIL = "owner@laikela.local";
const DEMO_PASSWORD = "laikela2026";

interface PendingVerification {
  email: string;
  /** 未配 SMTP 时后端回传，本机自测直接看得到；生产恒为 null */
  devCode?: string | null;
  expiresAt?: string;
  warning?: string | null;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<PendingVerification | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  const go = useCallback(() => {
    const next = params.get("next") ?? "/";
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }, [params, router]);

  // 重发倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (mode === "verify") codeRef.current?.focus();
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setHint(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await apiPost("/api/auth/login", { email, password });
        go();
        return;
      }

      if (mode === "register") {
        const res = await apiPost<{
          pending: true;
          email: string;
          expiresAt: string;
          devCode: string | null;
          mailDriver: string;
          warning: string | null;
        }>("/api/auth/register", { email, password, name, orgName });
        setPending({ email: res.email, devCode: res.devCode, expiresAt: res.expiresAt, warning: res.warning });
        setCode("");
        setMode("verify");
        setCooldown(60);
        setHint(
          res.mailDriver === "outbox"
            ? "当前未配置 SMTP，验证码只写进了数据库与控制台（见下方开发提示）。"
            : `验证码已发至 ${res.email}，${Math.round(
                (new Date(res.expiresAt).getTime() - Date.now()) / 60000,
              )} 分钟内有效。`,
        );
        setBusy(false);
        return;
      }

      // verify
      await apiPost("/api/auth/verify-email", { email: pending?.email ?? email, code });
      go();
      return;
    } catch (e2) {
      if (e2 instanceof ApiError) {
        // 密码对了但邮箱没验证：直接切到验证面板并自动补发一封
        if (e2.code === "EMAIL_UNVERIFIED") {
          const target = (e2.detail as { email?: string } | undefined)?.email ?? email;
          setPending({ email: target });
          setMode("verify");
          setBusy(false);
          void resend(target, true);
          return;
        }
        setErr(e2.message);
      } else {
        setErr("网络异常，请稍后再试");
      }
      setBusy(false);
    }
  };

  const resend = async (target?: string, silent = false) => {
    const to = target ?? pending?.email ?? email;
    if (!to) return;
    if (!silent) setErr(null);
    try {
      const res = await apiPost<{ sent: boolean; message: string; devCode: string | null; driver: string }>(
        "/api/auth/verify-email/resend",
        { email: to },
      );
      setCooldown(60);
      if (res.devCode) setPending((p) => ({ ...(p ?? { email: to }), devCode: res.devCode }));
      setHint(res.message);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "发送失败，请稍后再试");
    }
  };

  const backToForm = () => {
    setMode("login");
    setPending(null);
    setCode("");
    setErr(null);
    setHint(null);
  };

  /* ------------------------------ 验证码面板 ------------------------------ */
  if (mode === "verify") {
    const target = pending?.email ?? email;
    return (
      <div className="animate-rise">
        <h2 className="serif text-[26px] leading-tight">验证你的邮箱</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
          我们向 <span className="mono" style={{ color: "var(--t1)" }}>{target}</span> 发了一封
          6 位验证码，验证通过才会创建登录会话。
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5" noValidate>
          <label className="field">
            <span className="field-label">
              验证码<span className="req">必填</span>
            </span>
            <input
              ref={codeRef}
              className="input mono text-center"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="······"
              inputMode="numeric"
              autoComplete="one-time-code"
              style={{ fontSize: 22, letterSpacing: 10, height: 48 }}
              required
            />
            <span className="field-hint">
              15 分钟内有效，输错 5 次作废。没收到？检查垃圾邮件，或点下方重新发送。
            </span>
          </label>

          {pending?.devCode && (
            <div
              className="rounded-[8px] border px-3 py-2 text-[11.5px]"
              style={{
                borderColor: "color-mix(in srgb, var(--gold) 45%, transparent)",
                background: "color-mix(in srgb, var(--gold) 10%, transparent)",
                color: "var(--gold)",
              }}
            >
              <span className="mono">开发模式</span> · 未配置 SMTP，验证码是{" "}
              <span className="mono text-[13px] font-semibold">{pending.devCode}</span>
              （同时写入了 mail_outbox 表）
            </div>
          )}

          {hint && !err && (
            <div className="text-[11.5px]" style={{ color: "var(--jade)" }}>
              {hint}
            </div>
          )}

          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[11.5px]"
              style={{
                borderColor: "color-mix(in srgb, var(--rose) 42%, transparent)",
                background: "color-mix(in srgb, var(--rose) 10%, transparent)",
                color: "var(--rose)",
              }}
            >
              <Icon name="alert" size={13} style={{ marginTop: 1 }} />
              <span>{err}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary mt-1 h-[40px] justify-center"
            disabled={busy || code.length !== 6}
          >
            {busy ? (
              <>
                <span className="spinner" />
                验证中…
              </>
            ) : (
              <>
                完成验证并进入
                <Icon name="arrow" size={14} />
              </>
            )}
          </button>

          <div className="flex items-center justify-between text-[11.5px]">
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void resend()}
              disabled={cooldown > 0}
            >
              {cooldown > 0 ? `${cooldown} 秒后可重发` : "重新发送验证码"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={backToForm}>
              返回登录
            </button>
          </div>
        </form>
      </div>
    );
  }

  /* ------------------------------ 登录 / 注册面板 ------------------------------ */
  return (
    <div className="animate-rise">
      <h2 className="serif text-[26px] leading-tight">
        {mode === "login" ? "回到你的工作台" : "创建一个工作空间"}
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
        {mode === "login"
          ? "登录后继续未完成的任务，积分与素材都还在。"
          : "注册即得体验版套餐，含 200 积分；邮箱验证通过后才算注册完成。"}
      </p>

      <div className="seg mt-6 w-full" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          data-on={mode === "login" ? "1" : undefined}
          onClick={() => {
            setMode("login");
            setErr(null);
            setHint(null);
          }}
          className="flex-1"
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          data-on={mode === "register" ? "1" : undefined}
          onClick={() => {
            setMode("register");
            setErr(null);
            setHint(null);
          }}
          className="flex-1"
        >
          注册
        </button>
      </div>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3.5" noValidate>
        {mode === "register" && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <label className="field">
              <span className="field-label">
                称呼<span className="req">必填</span>
              </span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：小满"
                autoComplete="name"
              />
            </label>
            <label className="field">
              <span className="field-label">工作空间名</span>
              <input
                className="input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="例如：小满的咖啡店"
                autoComplete="organization"
              />
            </label>
          </div>
        )}

        <label className="field">
          <span className="field-label">
            邮箱<span className="req">必填</span>
          </span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">
            密码<span className="req">必填</span>
          </span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "至少 8 位，建议字母 + 数字" : "输入密码"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
          />
          {mode === "register" && (
            <span className="field-hint">
              8 位以上；服务端用 scrypt 加盐摘要存储，不保存明文
            </span>
          )}
        </label>

        {err && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[11.5px]"
            style={{
              borderColor: "color-mix(in srgb, var(--rose) 42%, transparent)",
              background: "color-mix(in srgb, var(--rose) 10%, transparent)",
              color: "var(--rose)",
            }}
          >
            <Icon name="alert" size={13} style={{ marginTop: 1 }} />
            <span>{err}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary mt-1 h-[40px] justify-center" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" />
              {mode === "login" ? "登录中…" : "发送验证码…"}
            </>
          ) : (
            <>
              {mode === "login" ? "登录" : "注册并获取验证码"}
              <Icon name="arrow" size={14} />
            </>
          )}
        </button>
      </form>

      <div
        className="mt-5 rounded-[10px] border p-3"
        style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium" style={{ color: "var(--t2)" }}>
              本机管理员账号
            </div>
            <div className="mono mt-0.5 truncate text-[10.5px]" style={{ color: "var(--t3)" }}>
              {DEMO_EMAIL} / {DEMO_PASSWORD}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setEmail(DEMO_EMAIL);
              setPassword(DEMO_PASSWORD);
              setErr(null);
            }}
            className="btn btn-quiet btn-sm shrink-0"
          >
            一键填入
          </button>
        </div>
      </div>
    </div>
  );
}
