import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
  turbopack: {},
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
