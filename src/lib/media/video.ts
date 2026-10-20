import sharp from "sharp";

/**
 * 视频分镜与关键帧。
 * 本机没有 FFmpeg，所以不做 mp4 编码：产出「分镜表 + 关键帧序列 + 时间轴 JSON」，
 * 前端按时间轴播放关键帧并叠加字幕——这是可用的预览形态，
 * 接上 FFmpeg worker 后同一份 timeline 可直接渲染成片（见 README 的升级路径）。
 */

const SANS = "Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif";
const MONO = "Consolas, JetBrains Mono, monospace";
const SERIF = "Source Han Serif SC, Noto Serif SC, SimSun, serif";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface Shot {
  index: number;
  startMs: number;
  endMs: number;
  /** 画面描述 */
  scene: string;
  /** 台词 / 字幕 */
  caption: string;
  /** 这一镜的作用 */
  note: string;
}

export interface Timeline {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  shots: Shot[];
  /** 音频轨（若有） */
  audioAssetId?: string;
  meta: Record<string, unknown>;
}

export interface VideoPlan {
  timeline: Timeline;
  /** 素材缺失时的画面基调 */
  tone: "warm" | "cool" | "ink";
}

const ratioToSize = (ratio: string): { width: number; height: number } => {
  if (ratio.includes("16:9") || ratio.includes("横")) return { width: 1920, height: 1080 };
  if (ratio.includes("1:1") || ratio.includes("方")) return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
};

const seconds = (s: string): number => {
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 30;
};

/** 通用的营销片分镜骨架 */
const SKELETON = [
  { scene: "开场：产品/门店主视觉，字幕压屏", caption: "{topic}，先给你看结果", note: "3 秒抓人" },
  { scene: "痛点场景：目标用户的典型困境", caption: "你是不是也遇到过这个麻烦", note: "建立共鸣" },
  { scene: "卖点演示：手部特写 + 分点字幕", caption: "{point}", note: "交付价值" },
  { scene: "细节特写：材质/工艺/成分", caption: "细节决定体验", note: "增强可信度" },
  { scene: "对比画面：使用前 / 使用后", caption: "同样的时间，不同的结果", note: "用对比代替形容词" },
  { scene: "人物出镜：直面镜头说一句真话", caption: "{cta}", note: "收口转化" },
  { scene: "信息卡：价格 / 地址 / 联系方式", caption: "{topic} · 现在可以开始", note: "承接流量" },
  { scene: "结尾品牌板：logo + 一句话", caption: "来客啦 · 让内容更接近爆款", note: "品牌记忆" },
];

export function buildShots(
  opts: { durationSec: number; ratio: string; topic: string; point: string; cta: string; extra?: string[] },
): { shots: Shot[]; width: number; height: number; durationMs: number } {
  const { width, height } = ratioToSize(opts.ratio);
  const count = opts.durationSec <= 15 ? 5 : opts.durationSec <= 30 ? 7 : 9;
  const per = (opts.durationSec * 1000) / count;

  const shots: Shot[] = Array.from({ length: count }, (_, i) => {
    const base = SKELETON[i % SKELETON.length];
    const fill = (s: string) =>
      s
        .replace(/\{topic\}/g, opts.topic)
        .replace(/\{point\}/g, opts.point)
        .replace(/\{cta\}/g, opts.cta);
    return {
      index: i + 1,
      startMs: Math.round(i * per),
      endMs: Math.round((i + 1) * per),
      scene: fill(opts.extra?.[i] ?? base.scene),
      caption: fill(base.caption),
      note: base.note,
    };
  });

  return { shots, width, height, durationMs: Math.round(per * count) };
}

/* ------------------------------ 关键帧渲染 ------------------------------ */

const TONES: Record<string, { bg1: string; bg2: string; accent: string }> = {
  warm: { bg1: "#2A1D12", bg2: "#0B0908", accent: "#D8A85E" },
  cool: { bg1: "#12202A", bg2: "#080A0B", accent: "#7FB4C8" },
  ink: { bg1: "#1A1714", bg2: "#090706", accent: "#D8A85E" },
};

function wrap(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let u = 0;
  for (const ch of text) {
    const w = /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 1 : 0.55;
    if (u + w > maxUnits && cur) {
      lines.push(cur);
      cur = ch;
      u = w;
    } else {
      cur += ch;
      u += w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function shotSvg(
  shot: Shot,
  total: number,
  size: { width: number; height: number },
  tone: keyof typeof TONES,
): string {
  const { width: W, height: H } = size;
  const t = TONES[tone];
  const pad = Math.round(W * 0.06);
  const vertical = H > W;
  const sceneSize = Math.round(W * (vertical ? 0.042 : 0.028));
  const capSize = Math.round(W * (vertical ? 0.058 : 0.036));
  const capLines = wrap(shot.caption, vertical ? 11 : 22);

  // 每一镜的构图略有差异：交替左右偏置，避免看起来像同一张
  const off = shot.index % 2 === 0 ? 0.58 : 0.42;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${t.bg1}"/>
      <stop offset="100%" stop-color="${t.bg2}"/>
    </linearGradient>
    <radialGradient id="l" cx="${off * 100}%" cy="34%" r="62%">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${t.bg2}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sub" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0908" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0B0908" stop-opacity="0.92"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#b)"/>
  <rect width="${W}" height="${H}" fill="url(#l)"/>

  <!-- 构图參考线 -->
  <g stroke="${t.accent}" opacity="0.14" stroke-width="1">
    <line x1="${W * 0.333}" y1="0" x2="${W * 0.333}" y2="${H}"/>
    <line x1="${W * 0.666}" y1="0" x2="${W * 0.666}" y2="${H}"/>
    <line x1="0" y1="${H * 0.333}" x2="${W}" y2="${H * 0.333}"/>
    <line x1="0" y1="${H * 0.666}" x2="${W}" y2="${H * 0.666}"/>
  </g>

  <!-- 镜号 -->
  <text x="${pad}" y="${pad + sceneSize * 1.4}" font-family="${MONO}" font-size="${sceneSize * 0.95}"
        fill="${t.accent}" letter-spacing="${sceneSize * 0.2}">SHOT ${String(shot.index).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
  <text x="${W - pad}" y="${pad + sceneSize * 1.4}" text-anchor="end" font-family="${MONO}"
        font-size="${sceneSize * 0.95}" fill="#968D80">${(shot.startMs / 1000).toFixed(1)}s — ${(shot.endMs / 1000).toFixed(1)}s</text>

  <!-- 画面描述（居中偏上） -->
  ${wrap(shot.scene, vertical ? 13 : 26)
    .map(
      (line, i) => `<text x="${pad}" y="${H * (vertical ? 0.42 : 0.44) + i * sceneSize * 1.5}"
        font-family="${SERIF}" font-size="${sceneSize}" fill="#F4EDE2" opacity="0.9">${esc(line)}</text>`,
    )
    .join("\n  ")}

  <!-- 字幕安全区背景 -->
  <rect x="0" y="${H * 0.68}" width="${W}" height="${H * 0.32}" fill="url(#sub)"/>

  <!-- 字幕 -->
  ${capLines
    .map(
      (line, i) => `<text x="${W / 2}" y="${H * 0.79 + i * capSize * 1.28}" text-anchor="middle"
        font-family="${SANS}" font-size="${capSize}" font-weight="700" fill="#FFFFFF"
        stroke="#0B0908" stroke-width="${capSize * 0.05}" paint-order="stroke">${esc(line)}</text>`,
    )
    .join("\n  ")}

  <!-- 作用标注 -->
  <text x="${W / 2}" y="${H - pad * 0.7}" text-anchor="middle" font-family="${MONO}"
        font-size="${sceneSize * 0.8}" fill="${t.accent}" opacity="0.75">${esc(shot.note)}</text>
</svg>`;
}

export async function renderShot(
  shot: Shot,
  total: number,
  size: { width: number; height: number },
  tone: keyof typeof TONES,
): Promise<Buffer> {
  const svg = shotSvg(shot, total, size, tone);
  const w = Math.round(size.width * 0.6);
  const h = Math.round(size.height * 0.6);
  return sharp(Buffer.from(svg), { density: 120 })
    .resize({ width: w, height: h, fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
