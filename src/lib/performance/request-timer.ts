/**
 * 请求作用域 timer（AsyncLocalStorage）+ staging-only 结构化日志。
 * 默认不在 production 打 timing 日志；可用 QYANE_PERF_TELEMETRY=1 打开。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/lib/common/logger";
import type { RequestTimer, TimingSnapshot } from "./timing";

const storage = new AsyncLocalStorage<RequestTimer>();

export function runWithRequestTimer<T>(
  timer: RequestTimer,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(timer, fn);
}

export function getRequestTimer(): RequestTimer | undefined {
  return storage.getStore();
}

/** 当前请求 timer 上打点；无 timer 时静默 */
export function markTiming(name: string): void {
  getRequestTimer()?.mark(name);
}

export function shouldEmitPerfLog(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = (env.QYANE_PERF_TELEMETRY || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  const vercel = (env.VERCEL_ENV || "").trim().toLowerCase();
  // Preview / 显式 staging 默认可观；production 需显式 flag
  return vercel === "preview";
}

export function logTimingSnapshot(
  snapshot: TimingSnapshot,
  meta: { route?: string; method?: string; requestId?: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!shouldEmitPerfLog(env)) return;
  logger.info("perf.timing", {
    total_ms: snapshot.total_ms,
    auth_ms: snapshot.auth_ms,
    db_ms: snapshot.db_ms,
    external_api_ms: snapshot.external_api_ms,
    llm_ms: snapshot.llm_ms,
    render_ms: snapshot.render_ms,
    route: meta.route,
    method: meta.method,
    requestId: meta.requestId,
  });
}
