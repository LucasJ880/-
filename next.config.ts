import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jspdf", "jspdf-autotable", "@sparticuz/chromium", "puppeteer-core", "@expo-google-fonts/noto-sans-sc"],
  // CJK-PDF：字体经运行时动态 resolve（躲 turbopack 静态打包），
  // NFT 输出追踪显式带上 TTF 与 chromium 资产
  outputFileTracingIncludes: {
    "/api/projects/\[id\]/generate-pdf": [
      "./node_modules/@expo-google-fonts/noto-sans-sc/400Regular/*.ttf",
      "./node_modules/@expo-google-fonts/noto-sans-sc/700Bold/*.ttf",
      "./node_modules/@expo-google-fonts/noto-sans-sc/package.json",
      // Chromium 浏览器二进制（brotli 包）由 executablePath() 运行时扫目录加载，
      // 静态追踪看不见 → 不显式声明就不进函数包（生产实测：/var/task/.../bin does not exist → 全部回落 HTML）
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    // Quote Operations Phase 2：客户报价 PDF 路由同样需要 CJK 字体 + 品牌 logo 被 trace 进函数包
    "/api/projects/\[id\]/quote-engine/\[quoteId\]/pdf": [
      "./node_modules/@expo-google-fonts/noto-sans-sc/400Regular/*.ttf",
      "./node_modules/@expo-google-fonts/noto-sans-sc/700Bold/*.ttf",
      "./node_modules/@expo-google-fonts/noto-sans-sc/package.json",
      "./public/brands/*.png",
      "./public/logo.png",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  turbopack: {},
  // 生产构建 OOM 治理（Vercel 容器把 Next build worker SIGKILL）：
  // 编译收回主进程——单一 Node 堆受 NODE_OPTIONS max-old-space-size 约束，
  // 避免 worker + 主进程各持 6GB 配额挤爆容器；并开启 webpack 内存优化。
  experimental: {
    webpackBuildWorker: false,
    webpackMemoryOptimizations: true,
  },
};

// Sentry 集成：仅当显式配置 SENTRY_DSN 时启用
// 未设置 DSN 时直接导出原始 config，避免无意义的构建告警
export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      // 组织和项目 slug 可选（仅在上传 source map 时需要）
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // MVP 默认关闭 source map 上传，避免构建失败
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      // 屏蔽构建日志，除非显式要求
      silent: !process.env.CI,
      disableLogger: true,
      // 自动打通 ad-block 干扰
      tunnelRoute: "/monitoring",
    })
  : nextConfig;
