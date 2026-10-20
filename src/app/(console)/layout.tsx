import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await ensureDb();
  // 页面级守卫：未登录直接跳登录页，避免先渲染骨架再闪一下
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-dvh">
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>

      <div className="lg:pl-[var(--shell-side)]">
        <Suspense fallback={<div className="h-[var(--shell-top)]" />}>
          <Topbar />
        </Suspense>

        <main className="mx-auto w-full max-w-[1440px] px-4 pb-[calc(var(--shell-tabbar)+24px)] pt-5 lg:px-7 lg:pb-14 lg:pt-7">
          {children}
        </main>
      </div>

      <Suspense fallback={null}>
        <MobileTabBar />
      </Suspense>
    </div>
  );
}
