import Link from "next/link";
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import type { ToolDef } from "@/lib/domain/tools";

const KIND_LABEL: Record<string, string> = {
  copy: "文案",
  image: "图片",
  audio: "音频",
  video: "视频",
};

export function ToolTile({
  tool,
  runs,
  compact = false,
}: {
  tool: ToolDef;
  runs?: number;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="tile group"
      style={{ "--art": `url(${tool.art})`, minHeight: compact ? 118 : 138 } as CSSProperties}
    >
      <div className="tile-art" aria-hidden="true" />

      <div className="relative flex items-start justify-between gap-2">
        <span
          className="glass grid h-8 w-8 place-items-center rounded-[9px]"
          style={{ color: "var(--gold-2)" }}
        >
          <Icon name={tool.icon} size={16} />
        </span>
        {tool.badge === "new" && <span className="chip chip-new">NEW</span>}
        {tool.badge === "hot" && <span className="chip chip-hot">HOT</span>}
      </div>

      <div className="relative mt-auto pt-3">
        <h3 className="serif text-[14.5px] leading-tight" style={{ color: "var(--t1)" }}>
          {tool.name}
        </h3>
        <p
          className="mt-1 line-clamp-2 text-[11.5px] leading-[1.5]"
          style={{ color: "var(--t2)" }}
        >
          {tool.tagline}
        </p>
        <div
          className="mono mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
          style={{ color: "var(--t3)" }}
        >
          <span>{KIND_LABEL[tool.kind] ?? tool.kind}</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>{tool.etaSeconds}s</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>{tool.creditCost} 积分</span>
          {typeof runs === "number" && runs > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>/</span>
              <span>用过 {runs} 次</span>
            </>
          )}
        </div>
      </div>

      <span
        className="absolute right-3 bottom-3 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0"
        style={{ color: "var(--gold)", transform: "translateX(-4px)" }}
        aria-hidden="true"
      >
        <Icon name="arrow" size={15} />
      </span>
    </Link>
  );
}
