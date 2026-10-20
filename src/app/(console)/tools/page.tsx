"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { ToolTile } from "@/components/home/ToolTile";
import { useHealth, useTools } from "@/lib/client/api";

function ToolsBrowser() {
  const sp = useSearchParams();
  const section = sp.get("section");
  const { data, isLoading } = useTools();
  const { data: health } = useHealth();

  const all = data?.tools ?? [];
  const sections = data?.sections ?? [];
  const active = sections.find((s) => s.id === section);
  const groups = active ? [active] : sections;

  const depsDown = health?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="eyebrow">CAPABILITY DIRECTORY</div>
        <h1 className="serif text-[26px] leading-tight sm:text-[30px]">
          {active ? active.name : "全部能力"}
          <span className="ml-2 text-[13px]" style={{ color: "var(--t3)" }}>
            {active ? active.desc : "15 个工具，五个能力域"}
          </span>
        </h1>
      </div>

      {depsDown.length > 0 && (
        <div
          className="rounded-[10px] border px-3.5 py-3"
          style={{
            borderColor: "color-mix(in srgb, var(--rose) 38%, transparent)",
            background: "var(--rose-soft)",
          }}
        >
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--rose)" }}>
            <Icon name="alert" size={14} />
            依赖未就绪，生成任务会失败
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {depsDown.map((c) => (
              <li key={c.id} className="mono text-[10.5px]" style={{ color: "var(--t2)" }}>
                {c.label}：{c.detail}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--t3)" }}>
            在项目目录执行 <code className="mono">docker compose up -d</code> 后刷新。
          </p>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-[138px]" />
          ))}
        </div>
      )}

      {groups.map((s) => {
        const tools = all.filter((t) => t.section === s.id);
        if (!tools.length) return null;
        return (
          <section key={s.id}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h2 className="serif text-[16px]">{s.name}</h2>
              <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
                {s.en} · {tools.length}
              </span>
              <Link
                href={`/tools?section=${s.id}`}
                className="ml-auto text-[11px]"
                style={{ color: "var(--gold)" }}
              >
                单独查看
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {tools.map((t) => (
                <ToolTile key={t.slug} tool={t} runs={t.runs} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function ToolsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-[400px]" />}>
      <ToolsBrowser />
    </Suspense>
  );
}
