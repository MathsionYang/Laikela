"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { NAV_MOBILE } from "./nav";

/** 移动端底部导航：带安全区内边距，图标 + 文字，触控高度 ≥44px */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
      style={{
        background: "color-mix(in srgb, var(--surface) 94%, transparent)",
        borderColor: "var(--line)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="主导航"
    >
      <ul className="flex items-stretch">
        {NAV_MOBILE.map((item) => {
          const active =
            item.key === "/" ? pathname === "/" : pathname.startsWith(item.key);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex h-[var(--shell-tabbar)] flex-col items-center justify-center gap-[3px]"
                style={{ color: active ? "var(--gold)" : "var(--t3)" }}
              >
                <Icon name={item.icon} size={19} />
                <span className="text-[10px] leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
