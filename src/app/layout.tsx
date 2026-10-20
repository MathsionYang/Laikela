import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "来客啦 · AI 内容营销专家",
  description:
    "从主题到成片的 AI 内容生产工作台：文案、图片、音频、视频、数字人与增长运营，统一任务、素材与审核。",
  applicationName: "来客啦",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#090706",
};

// 首屏前应用主题，避免深浅色闪一下
const themeScript = `(function(){try{var t=localStorage.getItem('laikela-theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
