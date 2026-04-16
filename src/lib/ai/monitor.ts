/**
 * AI 调用监控 — 记录成功率、延迟、错误、token 成本
 *
 * 内存聚合用于 dashboard；同时通过 logger.info("ai.call", ...) 输出结构化日志，
 * 便于 Vercel Logs / Sentry 按用户聚合成本。
 */

import { logger } from "@/lib/common/logger";
import { getRequestContext } from "@/lib/common/request-context";

interface CallRecord {
  model: string;
  success: boolean;
  elapsedMs: number;
  error?: string;
  timestamp: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  userId?: string;
  route?: string;
}

const MAX_RECORDS = 1000;
const _records: CallRecord[] = [];

export interface RecordAiCallInput {
  model: string;
  success: boolean;
  elapsedMs: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 覆盖默认从 request context 取的 userId */
  userId?: string;
  /** 调用点标识（如 "agent-core", "ai-chat"），便于分类 */
  source?: string;
}

export function recordAiCall(input: RecordAiCallInput) {
  const ctx = getRequestContext();
  const record: CallRecord = {
    model: input.model,
    success: input.success,
    elapsedMs: input.elapsedMs,
    error: input.error,
    timestamp: Date.now(),
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens:
      input.totalTokens ??
      (input.promptTokens != null && input.completionTokens != null
        ? input.promptTokens + input.completionTokens
        : undefined),
    userId: input.userId ?? ctx?.userId,
    route: ctx?.route,
  };
  _records.push(record);
  if (_records.length > MAX_RECORDS) {
    _records.splice(0, _records.length - MAX_RECORDS);
  }

  // 结构化日志：可在 Vercel Logs / Sentry 按字段聚合
  const event = input.success ? "ai.call" : "ai.call.error";
  const level = input.success ? "info" : "warn";
  logger[level](event, {
    source: input.source,
    model: input.model,
    elapsedMs: input.elapsedMs,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    userId: record.userId,
    err: input.error,
  });
}

/** 从 OpenAI 响应 usage 提取 token 数（类型宽松以兼容 DeepSeek 等） */
export function extractUsage(response: unknown): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const r = response as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const usage = r?.usage;
  if (!usage) return {};
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export interface AiStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  recentErrors: Array<{ model: string; error: string; timestamp: number }>;
  byModel: Record<
    string,
    { calls: number; avgMs: number; failures: number; totalTokens: number }
  >;
  byUser: Record<string, { calls: number; totalTokens: number }>;
}

export function getAiStats(windowMinutes = 60): AiStats {
  const cutoff = Date.now() - windowMinutes * 60000;
  const recent = _records.filter((r) => r.timestamp >= cutoff);

  const totalCalls = recent.length;
  const successCount = recent.filter((r) => r.success).length;
  const failureCount = totalCalls - successCount;
  const successRate = totalCalls > 0 ? successCount / totalCalls : 1;

  const latencies = recent
    .filter((r) => r.success)
    .map((r) => r.elapsedMs)
    .sort((a, b) => a - b);
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
  const p95LatencyMs =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  const byModel: AiStats["byModel"] = {};
  const byUser: AiStats["byUser"] = {};

  for (const r of recent) {
    totalPromptTokens += r.promptTokens ?? 0;
    totalCompletionTokens += r.completionTokens ?? 0;
    totalTokens += r.totalTokens ?? 0;

    if (!byModel[r.model]) byModel[r.model] = { calls: 0, avgMs: 0, failures: 0, totalTokens: 0 };
    const m = byModel[r.model];
    m.calls++;
    if (!r.success) m.failures++;
    m.avgMs = Math.round((m.avgMs * (m.calls - 1) + r.elapsedMs) / m.calls);
    m.totalTokens += r.totalTokens ?? 0;

    const uid = r.userId ?? "anonymous";
    if (!byUser[uid]) byUser[uid] = { calls: 0, totalTokens: 0 };
    byUser[uid].calls++;
    byUser[uid].totalTokens += r.totalTokens ?? 0;
  }

  const recentErrors = recent
    .filter((r) => !r.success && r.error)
    .slice(-5)
    .map((r) => ({ model: r.model, error: r.error!, timestamp: r.timestamp }));

  return {
    totalCalls,
    successCount,
    failureCount,
    successRate,
    avgLatencyMs,
    p95LatencyMs,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    recentErrors,
    byModel,
    byUser,
  };
}
