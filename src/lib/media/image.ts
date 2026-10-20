import sharp from "sharp";

/**
 * 图片渲染。
 * 文字用真实字体经 SVG 光栅化，不做「模型生成文字」——这样海报和封面上的字永远清晰可读。
 * 设计语言与工作台一致：墨底、单一金色、衬线大字、等宽小字。
 */

const SANS = "Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif";
const SERIF = "Source Han Serif SC, Noto Serif SC, SimSun, serif";
const MONO = "Consolas, JetBrains Mono, monospace";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** 按视觉宽度折行：中文按 1 个字宽，英文数字按 0.55 */
function wrap(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let units = 0;
  for (const ch of text) {
    const w = /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 1 : /[A-Za-z0-9]/.test(ch) ? 0.56 : 0.4;
    if (units + w > maxUnits && cur) {
      lines.push(cur);
      cur = ch;
      units = w;
    } else {
      cur += ch;
      units += w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

const mix = (a: string, b: string, t: number) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(A.r, B.r)},${c(A.g, B.g)},${c(A.b, B.b)})`;
};

/* ---------------------------------------------------------------- */
/* 海报                                                               */
/* ---------------------------------------------------------------- */

export interface PosterInput {
  theme: string;
  title?: string;
  subtitle?: string;
  when?: string;
  eyebrow?: string;
  footer?: string;
  brand: string;
  accent: string;
  size: { width: number; height: number };
}

export function posterSvg(p: PosterInput): string {
  const { width: W, height: H } = p.size;
  const pad = Math.round(W * 0.083);
  const vertical = H >= W;
  const titleSize = Math.round(W * (vertical ? 0.098 : 0.072));
  const subSize = Math.round(W * (vertical ? 0.038 : 0.03));
  const eyebrowSize = Math.round(W * 0.02);
  const metaSize = Math.round(W * 0.024);

  const titleLines = wrap(p.title || p.theme, vertical ? 8.4 : 12);
  const titleTop = vertical ? H * 0.395 : H * 0.44;
  const lineGap = titleSize * 1.24;

  const accent = p.accent;
  const glow = mix(accent, "#141110", 0.55);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g1" cx="78%" cy="6%" r="72%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.30"/>
      <stop offset="46%" stop-color="${glow}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#0B0908" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="8%" cy="102%" r="58%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#0B0908" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.85"/>
      <stop offset="70%" stop-color="${accent}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#100D0C"/>
  <rect width="${W}" height="${H}" fill="url(#g1)"/>
  <rect width="${W}" height="${H}" fill="url(#g2)"/>

  <!-- 细网格，只做质感 -->
  <g opacity="0.20" stroke="${accent}" stroke-width="1">
    ${Array.from({ length: 7 }, (_, i) => {
      const x = pad + ((W - pad * 2) / 6) * i;
      return `<line x1="${x}" y1="${H * 0.5}" x2="${x}" y2="${H * 0.5 + H * 0.42}" opacity="${0.25 - i * 0.02}"/>`;
    }).join("")}
  </g>

  <!-- 同心圆装饰 -->
  <g transform="translate(${W - pad * 0.55} ${H * 0.155})" opacity="0.5" fill="none" stroke="${accent}">
    <circle r="${W * 0.115}" stroke-width="1.2" opacity="0.55"/>
    <circle r="${W * 0.078}" stroke-width="1" opacity="0.35"/>
    <circle r="${W * 0.042}" stroke-width="1" opacity="0.22"/>
    <circle r="3.4" fill="${accent}" stroke="none"/>
  </g>

  <!-- eyebrow -->
  <text x="${pad}" y="${H * 0.128}" font-family="${MONO}" font-size="${eyebrowSize}"
        letter-spacing="${eyebrowSize * 0.34}" fill="${accent}" opacity="0.92">${esc(p.eyebrow || "CAMPAIGN")}</text>
  <rect x="${pad}" y="${H * 0.145}" width="${W * 0.2}" height="2" fill="url(#rule)"/>

  <!-- 主标题 -->
  ${titleLines
    .map(
      (line, i) => `<text x="${pad}" y="${titleTop + i * lineGap}" font-family="${SERIF}"
        font-size="${titleSize}" font-weight="700" fill="#F4EDE2"
        letter-spacing="${-titleSize * 0.012}">${esc(line)}</text>`,
    )
    .join("\n  ")}

  <!-- 副标题 -->
  ${
    p.subtitle
      ? `<text x="${pad}" y="${titleTop + titleLines.length * lineGap + subSize * 0.4}"
           font-family="${SANS}" font-size="${subSize}" fill="#C6BCAD">${esc(p.subtitle)}</text>`
      : ""
  }

  <!-- 分隔 -->
  <rect x="${pad}" y="${H * 0.775}" width="${W - pad * 2}" height="1" fill="#F4EDE2" opacity="0.16"/>

  <!-- 时间与品牌 -->
  <text x="${pad}" y="${H * 0.835}" font-family="${SANS}" font-size="${metaSize}" fill="#F4EDE2" opacity="0.9">${esc(p.when || "")}</text>
  <text x="${pad}" y="${H * 0.9}" font-family="${MONO}" font-size="${metaSize * 0.86}" fill="${accent}" opacity="0.85"
        letter-spacing="${metaSize * 0.18}">${esc(p.footer || p.brand)}</text>

  <!-- 角标 -->
  <text x="${W - pad}" y="${H * 0.9}" text-anchor="end" font-family="${MONO}" font-size="${metaSize * 0.78}"
        fill="#968D80" letter-spacing="${metaSize * 0.12}">${esc(p.brand)}</text>
</svg>`;
}

/* ---------------------------------------------------------------- */
/* 封面                                                               */
/* ---------------------------------------------------------------- */

export interface CoverInput {
  copy: string;
  kicker: string;
  accent: string;
  size: { width: number; height: number };
  /** 关键帧底图（可选） */
  keyframe?: Buffer | null;
}

export function coverSvg(c: CoverInput): string {
  const { width: W, height: H } = c.size;
  const pad = Math.round(W * 0.075);
  const size = Math.round(W * 0.115);
  const lines = wrap(c.copy, 6.6);
  const totalH = lines.length * size * 1.22;
  const startY = H * 0.52 - totalH / 2 + size;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0908" stop-opacity="0.34"/>
      <stop offset="42%" stop-color="#0B0908" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#0B0908" stop-opacity="0.93"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%">
      <stop offset="60%" stop-color="#0B0908" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0B0908" stop-opacity="0.66"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#100D0C"/>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>

  <rect x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}" fill="none"
        stroke="${c.accent}" stroke-width="1.6" opacity="0.45" rx="6"/>

  <text x="${pad + W * 0.016}" y="${pad + size * 0.92}" font-family="${MONO}" font-size="${size * 0.28}"
        letter-spacing="${size * 0.1}" fill="${c.accent}">${esc(c.kicker)}</text>

  ${lines
    .map((line, i) => {
      const y = startY + i * size * 1.22;
      return `<text x="${pad + W * 0.016}" y="${y}" font-family="${SANS}" font-size="${size}"
        font-weight="800" fill="#FFFFFF" stroke="#0B0908" stroke-width="${size * 0.055}"
        paint-order="stroke" letter-spacing="${-size * 0.02}">${esc(line)}</text>`;
    })
    .join("\n  ")}

  <text x="${W - pad - W * 0.016}" y="${H - pad - size * 0.3}" text-anchor="end"
        font-family="${MONO}" font-size="${size * 0.24}" fill="#C6BCAD" opacity="0.8">AI · 来客啦</text>
</svg>`;
}

/* ---------------------------------------------------------------- */
/* 抽象创意图                                                         */
/* ---------------------------------------------------------------- */

const STYLE_TONES: Record<string, [string, string, string]> = {
  写实摄影: ["#C9A46A", "#3B2E24", "#E8DCC8"],
  电影感: ["#5E8C9E", "#141B22", "#D8B98A"],
  胶片颗粒: ["#C08A5E", "#241A14", "#EAD9BE"],
  "3D 渲染": ["#8E7BC0", "#161225", "#DCD2F5"],
  "极简平面": ["#96877A", "#141110", "#F4EDE2"],
};

export function artSvg(prompt: string, style: string, size: { width: number; height: number }): string {
  const { width: W, height: H } = size;
  const [a, b, c] = STYLE_TONES[style] ?? STYLE_TONES["极简平面"];
  const seed = Array.from(prompt).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 99991, 7);
  const rnd = (n: number) => ((Math.sin(seed * (n + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;

  const blobs = Array.from({ length: 5 }, (_, i) => {
    const cx = W * (0.15 + rnd(i) * 0.7);
    const cy = H * (0.15 + rnd(i + 9) * 0.7);
    const r = W * (0.16 + rnd(i + 3) * 0.3);
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}"
      fill="url(#blob${i})" opacity="${(0.34 + rnd(i + 5) * 0.3).toFixed(2)}"/>`;
  }).join("\n    ");

  const strokes = Array.from({ length: 9 }, (_, i) => {
    const y = H * (0.1 + i * 0.095);
    return `<line x1="0" y1="${y.toFixed(0)}" x2="${W}" y2="${(y + H * 0.06).toFixed(0)}"
      stroke="${c}" stroke-width="1" opacity="${(0.05 + rnd(i) * 0.12).toFixed(2)}"/>`;
  }).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${b}"/>
      <stop offset="100%" stop-color="#0B0908"/>
    </linearGradient>
    ${Array.from({ length: 5 }, (_, i) => `<radialGradient id="blob${i}">
      <stop offset="0%" stop-color="${i % 2 ? a : c}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${b}" stop-opacity="0"/>
    </radialGradient>`).join("\n    ")}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g filter="none">
    ${blobs}
  </g>
  <g>${strokes}</g>
  <rect width="${W}" height="${H}" fill="none" stroke="${a}" stroke-width="2" opacity="0.22"/>
  <g opacity="0.62">
    <rect x="${W * 0.06}" y="${H - H * 0.115}" width="${W * 0.88}" height="1" fill="${a}" opacity="0.5"/>
    <text x="${W * 0.06}" y="${H - H * 0.062}" font-family="${MONO}" font-size="${Math.round(W * 0.026)}"
          fill="${c}" opacity="0.9">${esc(style)} · ${esc(prompt.slice(0, 26))}</text>
  </g>
</svg>`;
}

/* ---------------------------------------------------------------- */
/* 光栅化                                                             */
/* ---------------------------------------------------------------- */

export async function rasterize(svg: string, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 144 })
    .resize({ width, height, fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function thumbnail(input: Buffer, maxW = 480): Promise<Buffer> {
  return sharp(input).resize({ width: maxW, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

export async function probeImage(input: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** 把用户上传的关键帧处理成封面可用的底图 */
export async function normalizeKeyframe(input: Buffer, size: { width: number; height: number }) {
  return sharp(input)
    .resize({ width: size.width, height: size.height, fit: "cover", position: "attention" })
    .modulate({ brightness: 0.92, saturation: 0.95 })
    .png()
    .toBuffer();
}
