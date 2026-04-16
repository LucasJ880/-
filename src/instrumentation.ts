/**
 * Sentry server/edge runtime 配置
 *
 * Next.js 在服务端/边缘 runtime 启动时会自动调用此文件的 `register()` 导出。
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;
const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

function initSentry(runtime: "nodejs" | "edge") {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    // MVP 阶段关闭性能采样（省额度）。上线稳定后可按需调到 0.1。
    tracesSampleRate: 0,
    // 只在生产/预览环境启用，避免本地开发噪音
    enabled: ENV !== "development",
    // 不向控制台重复打印错误
    debug: false,
    // 标记 runtime，便于在 Sentry UI 区分
    initialScope: {
      tags: { runtime },
    },
    // 过滤已知噪音（可按需扩展）
    ignoreErrors: [
      // 用户主动取消 fetch / stream 不算错误
      "AbortError",
      "The user aborted a request",
    ],
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    initSentry("nodejs");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    initSentry("edge");
  }
}

export const onRequestError = Sentry.captureRequestError;
