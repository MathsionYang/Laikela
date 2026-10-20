"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { ClientAsset } from "@/lib/client/api";

/** 图片结果：网格 + 灯箱 + 下载 */
export function ImageResult({ assets }: { assets: ClientAsset[] }) {
  const [zoom, setZoom] = useState<ClientAsset | null>(null);
  const finals = assets.filter((a) => a.role === "final");

  if (!finals.length) return <Empty />;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2">
        {finals.map((a) => (
          <figure key={a.id} className="group relative overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--line)" }}>
            <button type="button" onClick={() => setZoom(a)} className="block w-full" aria-label={`查看 ${a.name}`}>
              {/* 签名 URL 有有效期，用原生 img 以免被优化器缓存 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                className="w-full transition-transform duration-500 group-hover:scale-[1.03]"
                style={{ display: "block" }}
              />
            </button>
            <figcaption
              className="mono flex items-center justify-between gap-2 px-2 py-1.5 text-[9.5px]"
              style={{ background: "var(--surface-2)", color: "var(--t3)" }}
            >
              <span className="truncate">{a.name}</span>
              <span className="shrink-0">
                {a.width}×{a.height}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {finals.map((a) => (
          <a key={a.id} href={a.url} download={a.name} className="btn btn-quiet btn-sm">
            <Icon name="download" size={12} />
            {a.name}
          </a>
        ))}
      </div>

      {zoom && (
        <div
          className="animate-fade fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(6,5,4,.82)" }}
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.url}
            alt={zoom.name}
            className="max-h-[88vh] max-w-full rounded-[10px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="btn-icon absolute right-4 top-4"
            onClick={() => setZoom(null)}
            aria-label="关闭预览"
            style={{ background: "var(--surface)", borderColor: "var(--line-2)" }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-40 items-center justify-center text-[12px]" style={{ color: "var(--t3)" }}>
      没有可展示的图片
    </div>
  );
}
