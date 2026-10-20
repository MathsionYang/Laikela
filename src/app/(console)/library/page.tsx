"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  useAssets,
  useDeleteAsset,
  useHealth,
  type ClientAsset,
} from "@/lib/client/api";

/**
 * 素材库。
 *
 * 四类产出（文字 / 图片 / 音频 / 视频）都落在这里，预览形态各自不同：
 *   · 文字 → 正文摘要 + 全文弹层（按需拉取，不把正文塞进列表接口）
 *   · 图片 → 缩略图，点开看原图
 *   · 音频 → 原生播放器
 *   · 视频 → 原生播放器（本机分镜任务产出的是关键帧，归到「分镜」）
 * 每个卡片都能下载（文件名取素材名）与删除（连本地文件一起删）。
 */

const FILTERS = [
  { key: "", label: "全部" },
  { key: "text", label: "文字" },
  { key: "image", label: "图片" },
  { key: "audio", label: "音频" },
  { key: "video", label: "视频" },
  { key: "keyframe", label: "分镜" },
  { key: "document", label: "文件" },
];

/** 与 useAssets 的请求上限保持一致；超了就显式提示，不静默截断 */
const PAGE_LIMIT = 1000;

const KIND_ICON: Record<string, string> = {
  text: "doc",
  image: "image",
  keyframe: "frame",
  audio: "wave",
  video: "film",
  document: "folder",
};

export default function LibraryPage() {
  const [kind, setKind] = useState("");
  const { data, isLoading } = useAssets(kind || undefined);
  const { data: health } = useHealth();
  const del = useDeleteAsset();
  const [zoom, setZoom] = useState<ClientAsset | null>(null);
  const [reading, setReading] = useState<{ asset: ClientAsset; body: string } | null>(null);
  /** 待删除的素材：点一下弹确认框，不再用「再点一次」的短暂时窗 */
  const [pending, setPending] = useState<ClientAsset | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 缩略图是卡片小图，不进列表；时间轴 JSON 只在「文件」档露出。
  // 「全部」只放成品（final / original）—— 分镜和时间轴属于任务的中间产物，
  // 混进来会让同一个任务的 6 张关键帧占满一屏，看起来像重复素材。
  const assets = useMemo(() => {
    const rows = data ?? [];
    if (kind === "document") return rows.filter((a) => a.role !== "thumbnail");
    if (kind === "keyframe") return rows.filter((a) => a.role === "proxy");
    if (kind) return rows.filter((a) => a.role !== "thumbnail" && a.role !== "metadata");
    return rows.filter((a) => a.role === "final" || a.role === "original");
  }, [data, kind]);

  const storage = health?.checks.find((c) => c.id === "storage");
  const localMode = Boolean(storage?.detail.startsWith("本地目录"));
  // 一次拉满：素材库要「实际产出多少显示多少」，被静默截断比慢一点更难解释
  const truncated = (data?.length ?? 0) >= PAGE_LIMIT;

  async function readText(asset: ClientAsset) {
    setReading({ asset, body: "加载中…" });
    try {
      const res = await fetch(`${asset.downloadUrl}?inline=1`);
      const text = await res.text();
      setReading({ asset, body: res.ok ? text : `读取失败：${text}` });
    } catch (err) {
      setReading({ asset, body: `读取失败：${(err as Error).message}` });
    }
  }

  function remove(asset: ClientAsset) {
    setPending(asset);
  }

  function confirmRemove() {
    if (!pending) return;
    const asset = pending;
    del.mutate(asset.id, {
      onSuccess: (r) => {
        setPending(null);
        setZoom((z) => (z?.id === asset.id ? null : z));
        setNotice(`已删除「${r.deleted.name}」，回收 ${r.deleted.files} 个文件`);
      },
      onError: (e) => setNotice(`删除失败：${e.message}`),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="eyebrow">ASSET LIBRARY</div>
        <h1 className="serif text-[26px] leading-tight sm:text-[30px]">素材库</h1>
        <p className="text-[12px]" style={{ color: "var(--t3)" }}>
          文字、图片、音频、视频的生成结果都落在本地存储，可预览、可下载、可删除。
          默认只列成品；分镜与时间轴在对应分档里。
          {localMode && (
            <span className="mono ml-1.5" style={{ opacity: 0.8 }}>
              {storage?.detail.replace("本地目录 ", "")}
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
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
          {truncated && <span style={{ color: "#D98A85" }}> · 仅显示最近 {PAGE_LIMIT} 项</span>}
        </span>
      </div>

      {notice && (
        <div
          className="flex items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--line)", background: "var(--surface-2)", color: "var(--t2)" }}
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

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
          <Link href="/tools" className="btn btn-quiet btn-sm mt-1">
            打开能力目录
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {assets.map((a) => (
          <AssetCard
            key={a.id}
            asset={a}
            deleting={del.isPending && del.variables === a.id}
            onZoom={() => setZoom(a)}
            onRead={() => void readText(a)}
            onDelete={() => remove(a)}
          />
        ))}
      </div>

      {zoom && (
        <Lightbox
          asset={zoom}
          onClose={() => setZoom(null)}
          onDelete={() => {
            setZoom(null);
            remove(zoom);
          }}
        />
      )}

      {pending && (
        <div
          className="animate-fade fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(6,5,4,.84)" }}
          onClick={() => (del.isPending ? null : setPending(null))}
          role="dialog"
          aria-modal="true"
          aria-label="确认删除素材"
        >
          <div
            className="card flex w-full max-w-[420px] flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2.5">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                style={{ background: "rgba(192,80,74,.16)", color: "#D98A85" }}
              >
                <Icon name="trash" size={14} />
              </span>
              <div className="min-w-0">
                <h2 className="serif text-[15px]">删除这个素材？</h2>
                <p className="mono mt-0.5 truncate text-[11px]" style={{ color: "var(--t2)" }}>
                  {pending.name}
                </p>
                <p className="mono mt-1 text-[10px]" style={{ color: "var(--t3)" }}>
                  {pending.kind} · {fmtBytes(pending.bytes)} · {fmtDate(pending.createdAt)}
                </p>
              </div>
            </div>
            <p
              className="rounded-[7px] px-2.5 py-2 text-[11px] leading-[1.7]"
              style={{ background: "var(--surface-2)", color: "var(--t3)" }}
            >
              本地文件与缩略图会一并删除，
              <span style={{ color: "#D98A85" }}>不可恢复</span>
              。任务记录与积分流水不受影响。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={del.isPending}
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={del.isPending}
                onClick={confirmRemove}
                style={{
                  background: "rgba(192,80,74,.18)",
                  border: "1px solid rgba(192,80,74,.5)",
                  color: "#D98A85",
                }}
              >
                {del.isPending ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reading && (
        <div
          className="animate-fade fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(6,5,4,.84)" }}
          onClick={() => setReading(null)}
          role="dialog"
          aria-modal="true"
          aria-label="文案全文"
        >
          <div
            className="card flex max-h-[84vh] w-full max-w-[720px] flex-col gap-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="eyebrow">TEXT</div>
                <h2 className="serif truncate text-[16px]">{reading.asset.name}</h2>
                <p className="mono mt-0.5 text-[10px]" style={{ color: "var(--t3)" }}>
                  {fmtBytes(reading.asset.bytes)} · {fmtDate(reading.asset.createdAt)}
                </p>
              </div>
              <a href={reading.asset.downloadUrl} className="btn btn-quiet btn-sm shrink-0">
                <Icon name="download" size={12} /> 下载
              </a>
            </div>
            <pre
              className="flex-1 overflow-auto rounded-[8px] p-3 text-[12.5px] leading-[1.75] whitespace-pre-wrap"
              style={{ background: "var(--surface-2)", color: "var(--t1)" }}
            >
              {reading.body}
            </pre>
            <div className="flex justify-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReading(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- 卡片 ------------------------------- */

function AssetCard({
  asset: a,
  deleting,
  onZoom,
  onRead,
  onDelete,
}: {
  asset: ClientAsset;
  deleting: boolean;
  onZoom: () => void;
  onRead: () => void;
  onDelete: () => void;
}) {
  const isImage = a.kind === "image" || a.kind === "keyframe";
  const thumb = a.thumbUrl ?? a.url;

  return (
    <figure
      className="group relative overflow-hidden rounded-[10px] border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="relative">
        {isImage && (
          <button type="button" onClick={onZoom} className="block w-full" aria-label={`查看 ${a.name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={a.name}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          </button>
        )}

        {a.kind === "audio" && (
          <div
            className="flex aspect-[4/3] flex-col items-center justify-center gap-3 px-3"
            style={{ background: "var(--surface-2)" }}
          >
            <Icon name="wave" size={22} style={{ color: "var(--gold)" }} />
            <audio src={a.url} controls preload="metadata" className="w-full" />
            {a.durationMs ? (
              <span className="mono text-[9.5px]" style={{ color: "var(--t3)" }}>
                {fmtDuration(a.durationMs)}
              </span>
            ) : null}
          </div>
        )}

        {a.kind === "video" && (
          <div className="aspect-[4/3]" style={{ background: "var(--surface-2)" }}>
            <video
              src={a.url}
              controls
              preload="metadata"
              poster={a.thumbUrl ?? undefined}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {a.kind === "text" && (
          <button
            type="button"
            onClick={onRead}
            className="flex aspect-[4/3] w-full flex-col gap-1.5 p-3 text-left"
            style={{ background: "var(--surface-2)" }}
            aria-label={`阅读 ${a.name}`}
          >
            <Icon name="doc" size={16} style={{ color: "var(--gold)" }} />
            <span className="line-clamp-5 text-[11px] leading-[1.6]" style={{ color: "var(--t2)" }}>
              {a.preview ?? "（无预览）"}
            </span>
          </button>
        )}

        {!isImage && a.kind !== "audio" && a.kind !== "video" && a.kind !== "text" && (
          <div
            className="flex aspect-[4/3] flex-col items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", color: "var(--t3)" }}
          >
            <Icon name={KIND_ICON[a.kind] ?? "folder"} size={22} />
            <span className="mono text-[9.5px] uppercase">{a.kind}</span>
          </div>
        )}

        {/* 悬停操作：下载 / 删除 */}
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
          <a
            href={a.downloadUrl}
            aria-label={`下载 ${a.name}`}
            title="下载"
            className="grid h-7 w-7 place-items-center rounded-[7px]"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              color: "var(--gold)",
            }}
          >
            <Icon name="download" size={12} />
          </a>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            aria-label={`删除 ${a.name}`}
            title="删除"
            className="grid h-7 w-7 place-items-center rounded-[7px]"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              color: "var(--t2)",
              cursor: deleting ? "progress" : "pointer",
            }}
          >
            {deleting ? (
              <span className="mono text-[9px]">…</span>
            ) : (
              <Icon name="trash" size={12} />
            )}
          </button>
        </div>

        {a.kind === "keyframe" && (
          <span
            className="mono absolute top-1.5 left-1.5 rounded-[4px] px-1.5 py-0.5 text-[9px]"
            style={{ background: "rgba(6,5,4,.62)", color: "var(--t2)" }}
          >
            分镜
          </span>
        )}
      </div>

      <figcaption className="px-2 py-1.5">
        <div className="truncate text-[11px]" style={{ color: "var(--t2)" }} title={a.name}>
          {a.name}
        </div>
        <div
          className="mono mt-0.5 flex items-center justify-between text-[9.5px]"
          style={{ color: "var(--t3)" }}
        >
          <span>{a.kind === "image" && a.width ? `${a.width}×${a.height}` : fmtBytes(a.bytes)}</span>
          <span>{fmtDate(a.createdAt)}</span>
        </div>
      </figcaption>
    </figure>
  );
}

function Lightbox({
  asset,
  onClose,
  onDelete,
}: {
  asset: ClientAsset;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(6,5,4,.84)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.url}
        alt={asset.name}
        className="max-h-[86vh] max-w-full rounded-[10px]"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute bottom-4 flex items-center gap-2">
        <a href={asset.downloadUrl} className="btn btn-quiet btn-sm">
          <Icon name="download" size={12} /> 下载
        </a>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDelete}>
          <Icon name="trash" size={12} /> 删除
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>
      <button
        type="button"
        className="btn-icon absolute top-4 right-4"
        onClick={onClose}
        aria-label="关闭"
        style={{ background: "var(--surface)", borderColor: "var(--line-2)" }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/* ------------------------------- 工具函数 ------------------------------- */

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
