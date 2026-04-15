/**
 * AI 调用监控 — 记录成功率、延迟、错误
 *
 * 生产环境可替换为外部指标服务（Datadog / Prometheus）。
 */

interface CallRecord {
  model: string;
  success: boolean;
  elapsedMs: number;
  error?: string;
  timestamp: number;
}

const MAX_RECORDS = 500;
const _records: CallRecord[] = [];

export function recordAiCall(record: Omit<CallRecord, "timestamp">) {
  _records.push({ ...record, timestamp: Date.now() });
  if (_records.length > MAX_RECORDS) _records.splice(0, _records.length - MAX_RECORDS);
}

export interface AiStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  recentErrors: Array<{ model: string; error: string; timestamp: number }>;
  byModel: Record<string, { calls: number; avgMs: number; failures: number }>;
}

export function getAiStats(windowMinutes = 60): AiStats {
  const cutoff = Date.now() - windowMinutes * 60000;
  const recent = _records.filter((r) => r.timestamp >= cutoff);

  const totalCalls = recent.length;
  const successCount = recent.filter((r) => r.success).length;
  const failureCount = totalCalls - successCount;
  const successRate = totalCalls > 0 ? successCount / totalCalls : 1;

  const latencies = recent.filter((r) => r.success).map((r) => r.elapsedMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95LatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const recentErrors = recent
    .filter((r) => !r.success && r.error)
    .slice(-5)
    .map((r) => ({ model: r.model, error: r.error!, timestamp: r.timestamp }));

  const byModel: AiStats["byModel"] = {};
  for (const r of recent) {
    if (!byModel[r.model]) byModel[r.model] = { calls: 0, avgMs: 0, failures: 0 };
    const m = byModel[r.model];
    m.calls++;
    if (!r.success) m.failures++;
    m.avgMs = Math.round((m.avgMs * (m.calls - 1) + r.elapsedMs) / m.calls);
  }

  return { totalCalls, successCount, failureCount, successRate, avgLatencyMs, p95LatencyMs, recentErrors, byModel };
}
