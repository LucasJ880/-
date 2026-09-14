/**
 * 请求级耗时计时器（只记录 metric 名 + 毫秒，禁止写入业务数据）。
 *
 * 用法：
 *   const timer = createRequestTimer();
 *   timer.mark("auth");
 *   timer.mark("db");
 *   const snapshot = timer.finish();
 */

export const QYANE_PERFORMANCE_BUDGET = {
  interactionFeedbackMs: 200,
  pageShellMs: 1_000,
  usefulContentMs: 2_000,
  apiP50Ms: 300,
  apiP95Ms: 800,
  dbOnlyTargetMs: 400,
  aiUiFeedbackMs: 300,
  ttftTargetMs: 2_000,
} as const;

/** Server-Timing / 日志允许的 metric 名（拒绝任意字符串，避免泄漏 SQL/表名） */
export const ALLOWED_TIMING_METRICS = [
  "total",
  "auth",
  "db",
  "llm",
  "openai",
  "firecrawl",
  "tavily",
  "serper",
  "external_api",
  "render",
  "blob",
  "cache",
  "ttft",
] as const;

export type TimingMetric = (typeof ALLOWED_TIMING_METRICS)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_TIMING_METRICS);

export function isAllowedTimingMetric(name: string): name is TimingMetric {
  return ALLOWED_SET.has(name);
}

export interface TimingMark {
  name: TimingMetric;
  durMs: number;
}

export interface TimingSnapshot {
  total_ms: number;
  auth_ms: number | null;
  db_ms: number | null;
  external_api_ms: number | null;
  llm_ms: number | null;
  render_ms: number | null;
  marks: TimingMark[];
}

export interface RequestTimer {
  /** 记录从上一 mark（或 start）到现在的分段；非法名被忽略 */
  mark(name: string): void;
  /** 结束计时并汇总；可重复调用，返回同一快照 */
  finish(): TimingSnapshot;
  startedAt(): number;
}

function roundMs(n: number): number {
  return Math.max(0, Math.round(n));
}

export function createRequestTimer(now: () => number = Date.now): RequestTimer {
  const startedAt = now();
  let lastAt = startedAt;
  const marks: TimingMark[] = [];
  let snapshot: TimingSnapshot | null = null;

  return {
    startedAt: () => startedAt,
    mark(name: string) {
      if (snapshot) return;
      if (!isAllowedTimingMetric(name) || name === "total") return;
      const t = now();
      marks.push({ name, durMs: roundMs(t - lastAt) });
      lastAt = t;
    },
    finish() {
      if (snapshot) return snapshot;
      const total_ms = roundMs(now() - startedAt);
      const byName = (n: TimingMetric): number | null => {
        const hit = marks.filter((m) => m.name === n);
        if (hit.length === 0) return null;
        return hit.reduce((sum, m) => sum + m.durMs, 0);
      };
      const openai = byName("openai") ?? 0;
      const firecrawl = byName("firecrawl") ?? 0;
      const tavily = byName("tavily") ?? 0;
      const serper = byName("serper") ?? 0;
      const explicitExternal = byName("external_api") ?? 0;
      const llmDirect = byName("llm");
      const hasExternalParts =
        openai + firecrawl + tavily + serper + explicitExternal > 0;
      snapshot = {
        total_ms,
        auth_ms: byName("auth"),
        db_ms: byName("db"),
        external_api_ms: hasExternalParts
          ? openai + firecrawl + tavily + serper + explicitExternal
          : null,
        llm_ms: llmDirect ?? (openai > 0 ? openai : null),
        render_ms: byName("render"),
        marks: [...marks, { name: "total", durMs: total_ms }],
      };
      return snapshot;
    },
  };
}
