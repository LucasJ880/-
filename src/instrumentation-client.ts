/**
 * Sentry client 运行时配置（浏览器）
 *
 * Next.js 自动在客户端 bundle 最前加载此文件。
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    enabled: ENV !== "development",
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: [
      "AbortError",
      "The user aborted a request",
      // 常见浏览器扩展噪音
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
