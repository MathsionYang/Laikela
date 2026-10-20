"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useAssets, type ClientAsset } from "@/lib/client/api";

const FILTERS = [
  { key: "", label: "全部" },
  { key: "image", label: "图片" },
  { key: "audio", label: "音频" },
  { key: "video", label: "视频" },
  { key: "document", label: "文件" },
];

export default function LibraryPage() {
  const [kind, setKind] = useState("");
  const { data, isLoading } = useAssets(kind || undefined);
  const [zoom, setZoom] = useState<ClientAsset | null>(null);

  const assets = (data ?? []).filter((a) => a.role !== "thumbnail");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="eyebrow">ASSET LIBRARY</div>
        <h1 className="serif text-[26px] leading-tight sm:text-[30px]">素材库</h1>
        <p className="text-[12px]" style={{ color: "var(--t3)" }}>
          所有生成结果与上传素材自动归档。下载走短期签名链接，桶本身不公开。
        </p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setKind(f.key)}
            className="shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] transition-colors"
            style={{
              borderColor: kind === f.key ? "var(--gold-line)" : "var(--line)",
              background: kind === f.key ? "var(--gold-soft)" : "transparent",
              color: kind === f.key ? "var(--gold)" : "var(--t2)",
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="mono ml-auto shrink-0 text-[10.5px]" style={{ color: "var(--t3)" }}>
          {assets.length} 项
        </span>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[4/3]" />
          ))}
        </div>
      )}

      {!isLoading && assets.length === 0 && (
        <div className="card flex flex-col items-center gap-2 py-16">
          <Icon name="folder" size={26} style={{ color: "var(--t3)" }} />
          <p className="text-[12.5px]" style={{ color: "var(--t2)" }}>
            这里还是空的
          </p>
          <p className="text-[11px]" style={{ color: "var(--t3)" }}>
            去能力目录跑一个任务，产出会自动进来
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {assets.map((a) => (
          <figure
            key={a.id}
            className="group overflow-hidden rounded-[10px] border"
            style={{ borderColor: "var(--line)", background: "var(--surface)" }}
          >
            {a.kind === "image" ? (
              <button type="button" onClick={() => setZoom(a)} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  className="w-full transition-transform duration-500 group-hover:scale-[1.04]"
                />
              </button>
            ) : (
              <div
                className="flex aspect-[4/3] flex-col items-center justify-center gap-2"
                style={{ background: "var(--surface-2)", color: "var(--t3)" }}
              >
                <Icon
                  name={a.kind === "audio" ? "wave" : a.kind === "video" ? "film" : "folder"}
                  size={22}
                />
                <span className="mono text-[9.5px] uppercase">{a.kind}</span>
              </div>
            )}
            <figcaption className="px-2 py-1.5">
              <div className="truncate text-[11px]" style={{ color: "var(--t2)" }}>
                {a.name}
              </div>
              <div className="mono mt-0.5 flex items-center justify-between text-[9.5px]" style={{ color: "var(--t3)" }}>
                <span>
                  {a.width ? `${a.width}×${a.height}` : fmtBytes(a.bytes)}
                </span>
                <a href={a.url} download={a.name} aria-label={`下载 ${a.name}`} style={{ color: "var(--gold)" }}>
                  <Icon name="download" size={12} />
                </a>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {zoom && (
        <div
          className="animate-fade fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(6,5,4,.84)" }}
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="素材预览"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.url}
            alt={zoom.name}
            className="max-h-[86vh] max-w-full rounded-[10px]"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="btn-icon absolute right-4 top-4"
            onClick={() => setZoom(null)}
            aria-label="关闭"
            style={{ background: "var(--surface)", borderColor: "var(--line-2)" }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
