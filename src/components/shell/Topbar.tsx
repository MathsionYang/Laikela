"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useMe, useTools } from "@/lib/client/api";
import { useTheme } from "@/app/providers";

export function Topbar() {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const { data: me } = useMe();
  const credits = (me?.credits?.balance ?? 0).toLocaleString("zh-CN");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className="sticky top-0 z-20 flex h-[var(--shell-top)] items-center gap-3 border-b px-4 lg:px-6"
        style={{
          background: "color-mix(in srgb, var(--page) 86%, transparent)",
          borderColor: "var(--line)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* 移动端品牌 */}
        <Link href="/" className="flex items-center gap-2 lg:hidden">
          <span
            className="grid h-7 w-7 place-items-center rounded-[7px] text-[13px] font-semibold"
            style={{ background: "var(--gold)", color: "var(--on-gold)" }}
          >
            来
          </span>
          <span className="serif text-[14px]">来客啦</span>
        </Link>

        <div className="hidden items-center gap-2 text-[11.5px] lg:flex" style={{ color: "var(--t3)" }}>
          <span>工作空间</span>
          <Icon name="chevron" size={12} style={{ transform: "rotate(-90deg)" }} />
          <span style={{ color: "var(--t1)" }}>工作台总览</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* 搜索 */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hidden h-[34px] w-[240px] items-center gap-2 rounded-[9px] border px-2.5 text-left text-[12px] transition-colors md:flex"
            style={{
              background: "var(--surface-in)",
              borderColor: "var(--line)",
              color: "var(--t3)",
            }}
          >
            <Icon name="search" size={14} />
            <span className="flex-1 truncate">搜索工具或模板</span>
            <kbd
              className="mono rounded border px-1 py-[1px] text-[9.5px]"
              style={{ borderColor: "var(--line-2)", color: "var(--t3)" }}
            >
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            aria-label="搜索"
            onClick={() => setOpen(true)}
            className="btn-icon md:hidden"
          >
            <Icon name="search" size={16} />
          </button>

          <button type="button" aria-label="切换主题" onClick={toggle} className="btn-icon">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
          </button>

          <button type="button" aria-label="通知" className="btn-icon relative hidden sm:inline-flex">
            <Icon name="bell" size={15} />
            <span
              className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--rose)" }}
            />
          </button>

          <Link
            href="/billing"
            className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] transition-colors sm:flex"
            style={{
              borderColor: "var(--gold-line)",
              background: "var(--gold-soft)",
              color: "var(--gold)",
            }}
            title="可用积分 · 点击查看订阅"
          >
            <Icon name="wallet" size={13} />
            <span className="mono">{credits}</span>
          </Link>

          <Link href="/tools" className="btn btn-primary h-[34px]">
            <Icon name="plus" size={14} />
            <span className="hidden sm:inline">新建任务</span>
          </Link>
        </div>
      </header>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data } = useTools();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const tools = data?.tools ?? [];
    const k = q.trim().toLowerCase();
    if (!k) return tools.slice(0, 8);
    return tools
      .filter(
        (t) =>
          t.name.toLowerCase().includes(k) ||
          t.tagline.toLowerCase().includes(k) ||
          t.slug.includes(k),
      )
      .slice(0, 10);
  }, [data, q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setCursor(0);
    }
  }, [open]);

  const go = (slug: string) => {
    onOpenChange(false);
    router.push(`/tools/${slug}`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="animate-fade fixed inset-0 z-50"
          style={{ background: "rgba(6,5,4,.62)", backdropFilter: "blur(3px)" }}
        />
        <Dialog.Content
          className="animate-sheet fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[14px] border shadow-2xl"
          style={{ background: "var(--surface)", borderColor: "var(--line-2)" }}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">搜索工具</Dialog.Title>
          <div
            className="flex items-center gap-2.5 border-b px-4 py-3"
            style={{ borderColor: "var(--line)" }}
          >
            <Icon name="search" size={16} style={{ color: "var(--t3)" }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter" && results[cursor]) {
                  go(results[cursor].slug);
                }
              }}
              placeholder="输入工具名或能力，例如「海报」「口播」"
              className="w-full bg-transparent text-[14px] outline-none"
              style={{ color: "var(--t1)" }}
            />
            <kbd className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              ESC
            </kbd>
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-1.5">
            {results.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px]" style={{ color: "var(--t3)" }}>
                没有匹配的工具
              </div>
            )}
            {results.map((t, i) => (
              <button
                key={t.slug}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(t.slug)}
                className="flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left"
                style={{ background: i === cursor ? "var(--surface-3)" : "transparent" }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px]"
                  style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
                >
                  <Icon name={t.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" style={{ color: "var(--t1)" }}>
                    {t.name}
                  </span>
                  <span className="block truncate text-[11px]" style={{ color: "var(--t3)" }}>
                    {t.tagline}
                  </span>
                </span>
                <span className="mono shrink-0 text-[10px]" style={{ color: "var(--t3)" }}>
                  ≈{t.quote?.etaSeconds ?? t.etaBaseline}s
                </span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
