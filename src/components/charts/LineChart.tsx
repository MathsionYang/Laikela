"use client";

import { useMemo, useRef, useState } from "react";

export interface Point {
  label: string;
  value: number;
}

/** Catmull-Rom → Bezier，得到不过冲的平滑曲线 */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function LineChart({
  data,
  height = 168,
  accent = "var(--gold)",
  secondary = "var(--jade)",
  unit = "条",
}: {
  data: Point[];
  height?: number;
  accent?: string;
  secondary?: string;
  unit?: string;
}) {
  const W = 680;
  const H = height;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { pts, avgPts, max, tickLabels } = useMemo(() => {
    const values = data.map((d) => d.value);
    const rawMax = Math.max(1, ...values);
    const max = Math.ceil(rawMax / 5) * 5 || 5;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const step = values.length > 1 ? innerW / (values.length - 1) : 0;

    const toXY = (v: number, i: number): [number, number] => [
      padL + i * step,
      padT + innerH - (v / max) * innerH,
    ];

    const pts = values.map((v, i) => toXY(v, i));

    // 7 点滑动平均，作为第二层参照
    const avg = values.map((_, i) => {
      const from = Math.max(0, i - 3);
      const slice = values.slice(from, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
    const avgPts = avg.map((v, i) => toXY(v, i));

    const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i));
    return { pts, avgPts, max, tickLabels: ticks };
  }, [data, H]);

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = Math.min(1, Math.max(0, (x - padL) / innerW));
    const idx = Math.round(ratio * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, idx)));
  };

  const areaPath =
    pts.length > 1
      ? `${smoothPath(pts)} L ${pts[pts.length - 1][0]} ${padT + innerH} L ${pts[0][0]} ${padT + innerH} Z`
      : "";

  const hoverPoint = hover !== null ? pts[hover] : null;
  const tipW = 108;
  const tipX = hoverPoint ? Math.min(W - tipW - 4, Math.max(4, hoverPoint[0] - tipW / 2)) : 0;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto", display: "block", touchAction: "pan-y" }}
        role="img"
        aria-label={`近期产出趋势，最高 ${max} ${unit}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.26" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 网格与 y 轴 */}
        {tickLabels.map((t, i) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--line)"
                strokeWidth="1"
                strokeDasharray={i === 0 ? "0" : "3 4"}
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="c-axis"
                fontSize="9.5"
                fill="var(--t3)"
                fontFamily="var(--font-mono-stack)"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* x 轴标签：最多 6 个 */}
        {data.map((d, i) => {
          const every = Math.max(1, Math.ceil(data.length / 6));
          if (i % every !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={`${d.label}-${i}`}
              x={pts[i]?.[0] ?? padL}
              y={H - 8}
              textAnchor="middle"
              className="c-axis"
              fontSize="9.5"
              fill="var(--t3)"
              fontFamily="var(--font-mono-stack)"
            >
              {d.label}
            </text>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#lc-fill)" />}
        <path d={smoothPath(avgPts)} fill="none" stroke={secondary} strokeWidth="1.4" strokeDasharray="4 4" opacity="0.55" />
        <path d={smoothPath(pts)} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" />

        {/* 末端点 */}
        {pts.length > 0 && (
          <>
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.2" fill={accent} />
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="7" fill={accent} opacity="0.18" />
          </>
        )}

        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint[0]}
              y1={padT}
              x2={hoverPoint[0]}
              y2={padT + innerH}
              stroke={accent}
              strokeWidth="1"
              opacity="0.35"
            />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="3.6" fill={accent} stroke="var(--surface)" strokeWidth="1.6" />
            <g transform={`translate(${tipX} ${Math.max(2, hoverPoint[1] - 44)})`}>
              <rect width={tipW} height="40" rx="6" fill="var(--surface-3)" stroke="var(--line-2)" />
              <text x="9" y="16" fontSize="9.5" fill="var(--t3)" fontFamily="var(--font-mono-stack)">
                {data[hover!].label}
              </text>
              <text x="9" y="30" fontSize="12" fill="var(--t1)" fontFamily="var(--font-mono-stack)">
                {data[hover!].value} {unit}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
