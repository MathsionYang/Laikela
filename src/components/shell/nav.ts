export interface NavItem {
  href: string;
  label: string;
  icon: string;
  en?: string;
  badge?: "new" | "hot";
  /** 用于高亮判断的 key */
  key: string;
}

export const NAV_MAIN: NavItem[] = [
  { href: "/", label: "工作台总览", icon: "home", en: "OVERVIEW", key: "/" },
  { href: "/tools?section=copy", label: "AI 文案", icon: "pen", en: "COPYWRITING", key: "copy" },
  { href: "/tools?section=image", label: "图片与素材", icon: "image", en: "VISUAL", key: "image" },
  { href: "/tools?section=video", label: "视频工坊", icon: "play", en: "VIDEO", key: "video" },
  { href: "/tools?section=avatar", label: "AI 数字人", icon: "user", en: "AVATAR", key: "avatar" },
  { href: "/tools?section=growth", label: "增长运营", icon: "trend", en: "GROWTH", key: "growth" },
];

export const NAV_SUB: NavItem[] = [
  { href: "/library", label: "素材库", icon: "folder", badge: "new", key: "/library" },
  { href: "/growth", label: "增长看板", icon: "trend", key: "/growth" },
  { href: "/billing", label: "订阅与积分", icon: "wallet", key: "/billing" },
  { href: "/settings/models", label: "模型接入", icon: "spark", key: "/settings/models" },
  { href: "/admin", label: "管理台", icon: "sliders", key: "/admin" },
];

/** 移动端底部导航：只留 5 个最高频入口 */
export const NAV_MOBILE: NavItem[] = [
  { href: "/", label: "总览", icon: "home", key: "/" },
  { href: "/tools", label: "能力", icon: "layers", key: "/tools" },
  { href: "/library", label: "素材", icon: "folder", key: "/library" },
  { href: "/growth", label: "增长", icon: "trend", key: "/growth" },
  { href: "/admin", label: "设置", icon: "sliders", key: "/admin" },
];
