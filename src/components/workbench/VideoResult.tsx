"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { ClientAsset } from "@/lib/client/api";

interface Shot {
  index: number;
  startMs: number;
  endMs: number;
  scene: string;
  caption: string;
  note: string;
}

interface Timeline {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  shots: Shot[];
  meta: Record<string, unknown>;
}

interface FrameRef {
  shotIndex: number;
  variant: number;
  asset: ClientAsset;
}

/**
 * 视频结果：分镜关键帧播放器。
 * 按 timeline 的时间轴逐镜切换关键帧并叠字幕，等价于一条「可播放的分镜预览」。
 * 本机没有 FFmpeg，所以不做 mp4 编码；接入 FFmpeg worker 后可直接编码成片。
 */
export function VideoResult({
  timeline,
  frames,
  video,
  assets,
}: {
  timeline: Timeline;
  frames: FrameRef[];
  /** 云端生成的成片（Seedance）；没有就只播分镜预览 */
  video?: ClientAsset | null;
  assets: ClientAsset[];
}) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [variant, setVariant] = useState(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);
  const duration = timeline.durationMs;

  const variants = useMemo(
    () => Array.from(new Set(frames.map((f) => f.variant))).sort(),
    [frames],
  );

  const frameByShot = useMemo(() => {
    const map = new Map<number, ClientAsset>();
    for (const f of frames) if (f.variant === variant) map.set(f.shotIndex, f.asset);
    return map;
  }, [frames, variant]);

  const currentShot = useMemo(
    () => timeline.shots.find((s) => t >= s.startMs && t < s.endMs) ?? timeline.shots[0],
    [timeline.shots, t],
  );

  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    last.current = performance.now();
    const step = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, duration]);

  const frame = currentShot ? frameByShot.get(currentShot.index) : undefined;
  const aspect = timeline.width / timeline.height;

  const fmt = (ms: number) => {
    const s = ms / 1000;
    return `${s.toFixed(1)}s`;
  };

  const timelineAsset = assets.find((a) => a.name === "timeline.json");

  return (
    <div className="flex flex-col gap-3">
      {/* 真成片：云端模型跑通时优先展示，分镜预览退居为参考 */}
      {video && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-[10px]" style={{ color: "var(--gold)" }}>
              CLOUD RENDER · {video.name}
            </span>
            <a href={video.url} download={video.name} className="btn btn-quiet btn-sm">
              <Icon name="download" size={12} /> 下载
            </a>
          </div>
          <video
            src={video.url}
            controls
            playsInline
            className="w-full rounded-[10px] border"
            style={{ borderColor: "var(--line)", background: "#0B0908", maxHeight: "62vh" }}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* 播放器 */}
        <div className="mx-auto w-full lg:mx-0 lg:w-[300px] lg:shrink-0">
          <div
            className="relative overflow-hidden rounded-[10px] border"
            style={{
              borderColor: "var(--line)",
              background: "#0B0908",
              aspectRatio: `${aspect}`,
              maxHeight: "58vh",
              margin: "0 auto",
            }}
          >
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={frame.id}
                src={frame.url}
                alt={`分镜 ${currentShot?.index}`}
                className="animate-fade h-full w-full object-contain"
              />
            ) : (
              <div className="grid h-full place-items-center text-[11px]" style={{ color: "var(--t3)" }}>
                该镜头的关键帧未渲染
              </div>
            )}
            <div
              className="mono absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9.5px]"
              style={{ background: "rgba(9,7,6,.72)", color: "var(--gold)" }}
            >
              SHOT {String(currentShot?.index ?? 1).padStart(2, "0")} / {timeline.shots.length}
            </div>
          </div>

          {/* 控制条 */}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (t >= duration) setT(0);
                setPlaying((p) => !p);
              }}
            >
              <Icon name={playing ? "pause" : "play"} size={13} />
              {playing ? "暂停" : t >= duration ? "重播" : "播放"}
            </button>
            <input
              type="range"
              min={0}
              max={duration}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: "var(--gold)", height: 3 }}
              aria-label="播放进度"
            />
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {fmt(t)}
            </span>
          </div>

          {variants.length > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px]" style={{ color: "var(--t3)" }}>
                变体
              </span>
              <div className="seg">
                {variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-on={v === variant ? "1" : undefined}
                    onClick={() => {
                      setVariant(v);
                      setT(0);
                      setPlaying(false);
                    }}
                  >
                    #{v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 分镜表 */}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="eyebrow">分镜表</span>
            <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
              {timeline.shots.length} 镜 · {timeline.width}×{timeline.height} · {timeline.fps}fps
            </span>
          </div>
          <div
            className="overflow-hidden rounded-[9px] border"
            style={{ borderColor: "var(--line)", maxHeight: 260, overflowY: "auto" }}
          >
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--t3)" }}>
                  <th className="px-2 py-1.5 text-left font-normal">#</th>
                  <th className="px-2 py-1.5 text-left font-normal">时间</th>
                  <th className="px-2 py-1.5 text-left font-normal">画面</th>
                  <th className="px-2 py-1.5 text-left font-normal">台词 / 字幕</th>
                </tr>
              </thead>
              <tbody>
                {timeline.shots.map((s) => {
                  const active = s.index === currentShot?.index;
                  return (
                    <tr
                      key={s.index}
                      onClick={() => {
                        setT(s.startMs);
                        setPlaying(false);
                      }}
                      style={{
                        background: active ? "var(--gold-soft)" : "transparent",
                        borderTop: "1px solid var(--line)",
                        cursor: "pointer",
                      }}
                    >
                      <td className="mono px-2 py-1.5" style={{ color: "var(--t3)" }}>
                        {String(s.index).padStart(2, "0")}
                      </td>
                      <td className="mono px-2 py-1.5 whitespace-nowrap" style={{ color: "var(--t3)" }}>
                        {(s.startMs / 1000).toFixed(1)}–{(s.endMs / 1000).toFixed(1)}s
                      </td>
                      <td className="px-2 py-1.5" style={{ color: active ? "var(--t1)" : "var(--t2)" }}>
                        {s.scene}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: active ? "var(--gold)" : "var(--t2)" }}>
                        {s.caption}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {timelineAsset && (
          <a href={timelineAsset.url} download="timeline.json" className="btn btn-quiet btn-sm">
            <Icon name="download" size={12} />
            时间轴 JSON
          </a>
        )}
        {frames.slice(0, 4).map((f) => (
          <a key={f.asset.id} href={f.asset.url} download={`${f.asset.name}.png`} className="btn btn-quiet btn-sm">
            <Icon name="download" size={12} />
            分镜 {f.shotIndex}
          </a>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: "var(--t3)" }}>
        本机未安装 FFmpeg，输出为「分镜关键帧 + 时间轴 JSON」，可在此按时间轴预览。
        接上 FFmpeg worker 后，同一份 timeline 可直接编码为 mp4（9:16 / 1:1 / 16:9）。
      </p>
    </div>
  );
}
