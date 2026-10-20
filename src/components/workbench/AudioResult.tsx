"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

interface Segment {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * 音频结果：WaveSurfer 波形 + 分段校对。
 * 波形由真实 WAV 数据绘制，点击波形可跳转，便于逐句核对节奏。
 */
export function AudioResult({
  url,
  durationMs,
  segments,
  downloadName,
}: {
  url: string;
  durationMs: number;
  segments: Segment[];
  downloadName: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const wsRef = useRef<{ playPause: () => void; isPlaying: () => boolean; getCurrentTime: () => number; destroy: () => void; on: (e: string, cb: (...a: unknown[]) => void) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let instance: Awaited<ReturnType<typeof create>> | null = null;

    async function create() {
      const mod = await import("wavesurfer.js");
      const WaveSurfer = mod.default;
      if (disposed || !holder.current) return null;
      const ws = WaveSurfer.create({
        container: holder.current,
        url,
        height: 68,
        waveColor: "rgba(150,141,128,.42)",
        progressColor: "#D8A85E",
        cursorColor: "#F0CE9E",
        cursorWidth: 1,
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        normalize: true,
      });
      ws.on("ready", () => setReady(true));
      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => setPlaying(false));
      ws.on("timeupdate", (t) => setTime(Number(t) * 1000));
      ws.on("error", (e) => setError(String(e)));
      wsRef.current = ws as unknown as typeof wsRef.current;
      return ws;
    }

    void create().then((ws) => {
      instance = ws ?? null;
      if (disposed) instance?.destroy();
    });

    return () => {
      disposed = true;
      instance?.destroy();
      wsRef.current = null;
    };
  }, [url]);

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const activeIndex = segments.findIndex((s) => time >= s.startMs && time < s.endMs);

  return (
    <div className="flex flex-col gap-3">
      <div className="card-2 p-3.5" style={{ background: "var(--surface)" }}>
        <div
          ref={holder}
          className="w-full rounded-[7px]"
          style={{ background: "var(--surface-in)", minHeight: 68 }}
        />
        {!ready && !error && <div className="skeleton mt-2 h-[68px] w-full" />}
        {error && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--rose)" }}>
            波形加载失败：{error}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => wsRef.current?.playPause()}
            disabled={!ready}
          >
            <Icon name={playing ? "pause" : "play"} size={13} />
            {playing ? "暂停" : "播放"}
          </button>
          <div className="mono text-[11px]" style={{ color: "var(--t2)" }}>
            {fmt(time)} <span style={{ color: "var(--t3)" }}>/ {fmt(durationMs)}</span>
          </div>
          <a
            href={url}
            download={downloadName}
            className="btn btn-quiet btn-sm ml-auto"
          >
            <Icon name="download" size={13} />
            下载 WAV
          </a>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">分段时间戳</span>
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {segments.length} 句
          </span>
        </div>
        <ol className="max-h-[220px] overflow-y-auto rounded-[9px] border" style={{ borderColor: "var(--line)" }}>
          {segments.map((s, i) => (
            <li
              key={s.index}
              className="flex items-start gap-2.5 border-b px-3 py-2 last:border-0"
              style={{
                borderColor: "var(--line)",
                background: i === activeIndex ? "var(--gold-soft)" : "transparent",
              }}
            >
              <span className="mono shrink-0 text-[10px]" style={{ color: "var(--t3)", paddingTop: 2 }}>
                {fmt(s.startMs)}
              </span>
              <span
                className="min-w-0 flex-1 text-[11.5px] leading-relaxed"
                style={{ color: i === activeIndex ? "var(--gold)" : "var(--t2)" }}
              >
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: "var(--t3)" }}>
        音轨由本地合成器生成（未配置 TTS 供应商）：时长、分段与波形为真实数据，可直接用于校准口播节奏；
        接入 TTS 后输出格式不变。
      </p>
    </div>
  );
}
