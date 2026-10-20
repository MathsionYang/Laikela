"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ApiError, apiPost } from "@/lib/client/api";

type Mode = "login" | "register";

const DEMO_EMAIL = "owner@laikela.local";
const DEMO_PASSWORD = "laikela2026";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await apiPost("/api/auth/login", { email, password });
      } else {
        await apiPost("/api/auth/register", { email, password, name, orgName });
      }
      const next = params.get("next") ?? "/";
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "网络异常，请稍后再试");
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setMode("login");
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setErr(null);
  };

  return (
    <div className="animate-rise">
      <h2 className="serif text-[26px] leading-tight">
        {mode === "login" ? "回到你的工作台" : "创建一个工作空间"}
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
        {mode === "login"
          ? "登录后继续未完成的任务，积分与素材都还在。"
          : "注册即得体验版套餐，含 200 积分，够跑 200 次文案。"}
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
            <span className="field-hint">8 位以上；服务端用 scrypt 加盐摘要存储，不保存明文</span>
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
              {mode === "login" ? "登录中…" : "创建中…"}
            </>
          ) : (
            <>
              {mode === "login" ? "登录" : "创建账号"}
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
              演示账号
            </div>
            <div className="mono mt-0.5 truncate text-[10.5px]" style={{ color: "var(--t3)" }}>
              {DEMO_EMAIL} / {DEMO_PASSWORD}
            </div>
          </div>
          <button type="button" onClick={fillDemo} className="btn btn-quiet btn-sm shrink-0">
            一键填入
          </button>
        </div>
      </div>
    </div>
  );
}
