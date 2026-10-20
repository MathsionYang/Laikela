/**
 * 模板 DSL —— 海报 / 封面 / 视频共用一套描述。
 * 与文档 4.3 的结构一致：canvas + layers + variables，
 * 同一模板可被「海报设计」「网感封面」「门店引流」复用，只替换变量。
 */

export interface TemplateLayer {
  type: "image" | "text" | "shape" | "video" | "audio";
  slot: string;
  fit?: "cover" | "contain";
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  safeArea?: boolean;
  volume?: number;
  start?: number;
  duration?: number;
}

export interface TemplateSpec {
  canvas: { width: number; height: number; fps?: number };
  layers: TemplateLayer[];
  variables: string[];
}

export interface TemplateDef {
  id: string;
  kind: "poster" | "cover" | "video";
  name: string;
  version: string;
  spec: TemplateSpec;
}

const poster = (w: number, h: number, id: string, name: string): TemplateDef => ({
  id,
  kind: "poster",
  name,
  version: "v1",
  spec: {
    canvas: { width: w, height: h },
    layers: [
      { type: "shape", slot: "bg", color: "#141110" },
      { type: "shape", slot: "glow" },
      { type: "text", slot: "eyebrow", size: 22, color: "accent", safeArea: true },
      { type: "text", slot: "title", size: 96, weight: 700, safeArea: true },
      { type: "text", slot: "subtitle", size: 38, safeArea: true },
      { type: "shape", slot: "rule" },
      { type: "text", slot: "when", size: 30, color: "muted", safeArea: true },
      { type: "text", slot: "footer", size: 24, color: "muted", safeArea: true },
    ],
    variables: ["eyebrow", "title", "subtitle", "when", "footer", "brand_color"],
  },
});

export const TEMPLATE_SPECS: TemplateDef[] = [
  poster(1080, 1440, "tpl_poster_vertical", "竖版海报"),
  poster(1080, 1080, "tpl_poster_square", "方版海报"),
  poster(1920, 1080, "tpl_poster_land", "横版海报"),
  {
    id: "tpl_cover_bold",
    kind: "cover",
    name: "大字报封面",
    version: "v1",
    spec: {
      canvas: { width: 1080, height: 1440 },
      layers: [
        { type: "image", slot: "keyframe", fit: "cover" },
        { type: "shape", slot: "scrim" },
        { type: "text", slot: "copy", size: 132, weight: 800, safeArea: true },
        { type: "text", slot: "kicker", size: 32, color: "accent", safeArea: true },
      ],
      variables: ["copy", "kicker", "keyframe"],
    },
  },
  {
    id: "tpl_video_vertical",
    kind: "video",
    name: "竖屏营销片",
    version: "v1",
    spec: {
      canvas: { width: 1080, height: 1920, fps: 30 },
      layers: [
        { type: "video", slot: "hero", fit: "cover", start: 0, duration: 4 },
        { type: "image", slot: "broll", fit: "cover", start: 4, duration: 6 },
        { type: "text", slot: "hook", size: 64, weight: 700, safeArea: true },
        { type: "text", slot: "cta", size: 48, safeArea: true },
        { type: "audio", slot: "bgm", volume: 0.18 },
        { type: "audio", slot: "vo", volume: 1 },
      ],
      variables: ["hook", "cta", "product_image", "brand_color"],
    },
  },
];

export const TEMPLATE_MAP = Object.fromEntries(TEMPLATE_SPECS.map((t) => [t.id, t]));
