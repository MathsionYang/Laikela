"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { logout, useMe } from "@/lib/client/api";
import { NAV_MAIN, NAV_SUB, type NavItem } from "./nav";

function useActive() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const section = sp.get("section");

  return (item: NavItem) => {
    if (item.key === "/") return pathname === "/";
    if (["copy", "image", "video", "avatar", "growth"].includes(item.key) && item.href.startsWith("/tools")) {
      return pathname.startsWith("/tools") && section === item.key;
    }
    return pathname.startsWith(item.key);
  };
}

export function Sidebar() {
  const isActive = useActive();

  const link = (item: NavItem) => {
    const active = isActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className="group flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[12.5px] transition-colors"
        style={{
          background: active ? "var(--gold-soft)" : "transparent",
          color: active ? "var(--gold)" : "var(--t2)",
          boxShadow: active ? "inset 0 0 0 1px var(--gold-line)" : undefined,
        }}
      >
        <Icon
          name={item.icon}
          size={15}
          style={{ opacity: active ? 1 : 0.72 }}
          className="shrink-0 transition-opacity group-hover:opacity-100"
        />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge === "new" && <span className="chip chip-new">NEW</span>}
      </Link>
    );
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-side)] flex-col border-r lg:flex"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      {/* 品牌 */}
      <div className="flex h-[var(--shell-top)] items-center gap-2.5 border-b px-4" style={{ borderColor: "var(--line)" }}>
        <div
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[14px] font-semibold"
          style={{ background: "var(--gold)", color: "var(--on-gold)" }}
        >
          来
        </div>
        <div className="min-w-0">
          <div className="serif truncate text-[14px] leading-tight" style={{ color: "var(--t1)" }}>
            来客啦
          </div>
          <div className="eyebrow truncate" style={{ fontSize: 9 }}>
            AI CONTENT STUDIO
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="eyebrow mb-1.5 px-2" style={{ fontSize: 9 }}>
          AI 内容营销组
        </div>
        <div className="flex flex-col gap-0.5">{NAV_MAIN.map(link)}</div>

        <div className="eyebrow mt-5 mb-1.5 px-2" style={{ fontSize: 9 }}>
          资产与运营
        </div>
        <div className="flex flex-col gap-0.5">{NAV_SUB.map(link)}</div>
      </nav>

      {/* 额度条 */}
      <QuotaCard />

      {/* 账号 */}
      <AccountBlock />
    </aside>
  );
}

function QuotaCard() {
  const { data } = useMe();
  const balance = data?.credits?.balance ?? 0;
  const monthly = data?.plan?.monthlyCredits ?? 0;
  const pct = monthly > 0 ? Math.min(100, Math.round((balance / monthly) * 100)) : 0;

  return (
    <div className="px-3 pb-2">
      <div className="inset px-3 py-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10.5px]" style={{ color: "var(--t3)" }}>
            可用积分
          </span>
          <span className="mono text-[11px]" style={{ color: "var(--gold)" }}>
            {balance.toLocaleString("zh-CN")}
            <span style={{ color: "var(--t3)" }}> / {monthly.toLocaleString("zh-CN")}</span>
          </span>
        </div>
        <div className="h-[3px] overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(pct, 1.5)}%`, background: pct < 15 ? "var(--rose)" : "var(--gold)" }}
          />
        </div>
        <Link
          href="/billing"
          className="mt-2 flex w-full items-center justify-between rounded-md px-2 py-1 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--t2)" }}
        >
          {data?.plan ? `${data.plan.name} · 升级或续订` : "选择套餐"}
          <Icon name="arrow" size={12} />
        </Link>
      </div>
    </div>
  );
}

function AccountBlock() {
  const { data } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const name = data?.user?.name ?? "未登录";
  const role = data?.user?.role === "owner" ? "所有者" : (data?.user?.role ?? "成员");
  const initial = name.slice(0, 1);

  const onLogout = async () => {
    await logout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="relative border-t" style={{ borderColor: "var(--line)" }}>
      {open && (
        <div
          className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-[9px] border py-1"
          style={{ background: "var(--surface-2)", borderColor: "var(--line-2)" }}
        >
          <div className="px-2.5 py-1.5 text-[10px]" style={{ color: "var(--t3)" }}>
            {data?.user?.email}
          </div>
          <Link
            href="/billing"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]"
            style={{ color: "var(--t1)" }}
          >
            <Icon name="wallet" size={13} />
            订阅与积分
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px]"
            style={{ color: "var(--rose)" }}
          >
            <Icon name="logout" size={13} />
            退出登录
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <div
          className="grid h-7 w-7 place-items-center rounded-full text-[11px]"
          style={{ background: "var(--surface-3)", color: "var(--gold)" }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px]" style={{ color: "var(--t1)" }}>
            {name}
          </div>
          <div className="truncate text-[10px]" style={{ color: "var(--t3)" }}>
            {data?.org?.name ?? "—"} · {role}
          </div>
        </div>
        <Icon name="chevron" size={13} style={{ color: "var(--t3)" }} />
      </button>
    </div>
  );
}
