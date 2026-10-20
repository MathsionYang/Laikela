import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 这三个包需要直接从 node_modules 加载，不能被打进 bundle：
  // sharp 要调用原生二进制，pglite 要定位 .wasm，pg 有可选的 native 绑定
  serverExternalPackages: ["sharp", "@electric-sql/pglite", "pg"],
  // 本地对象存储 / PGlite 数据目录不进依赖图
  outputFileTracingExcludes: {
    "*": ["data/**/*"],
  },
};

export default nextConfig;
