/**
 * V2 分片续跑游标（P0：serverless 硬超时下的可续跑分析）
 *
 * 背景（2026-08-15 生产事故）：EXTRACT_FACTS 在 V2 ON 时是单体长步——
 * N 个窗口 LLM + Clarify 逐条 LLM + Analyst PASS A/B，真实包（61 页）总时长
 * 超过 Vercel 函数 `maxDuration=300s`，函数被硬杀；而 V2 产出只在末尾一次性落库，
 * 于是每次重试都从零开始，永远跑不完 → 重试耗尽 → `lease_exhausted`。
 *
 * 本模块定义写入 `TenderAnalysisRun.workerCursor`（既有 Json 列，SCHEMA_CHANGE=NONE）
 * 的检查点状态：**每一次 LLM 调用的结果都落盘**，下一个 cron tick 从断点继续。
 *
 * 纯模块：无 DB、无 IO、无时钟依赖（now 由调用方传入），可确定性单测。
 */

import type {
  ExtractionOutputV2,
  ResolutionOutputV2,
} from "@/lib/tender-understanding/contract";
import type { LlmCallLog } from "@/lib/tender-understanding/llm";
import type {
  AnalystLlmOutput,
  AnalystQaOutput,
} from "@/lib/tender-analyst/contract";
import { sha256Content } from "./hash";

/** 游标结构版本：任何不兼容改动必须 +1（旧游标被判废后从头重跑，不得误读） */
export const V2_CURSOR_VERSION = 1;
export const V2_CURSOR_KIND = "tender-v2-resumable" as const;

/** 单窗口最大 LLM 尝试次数（跨 tick 累计）。用尽仍失败 → 记 limitations，不阻断整体。 */
export const MAX_WINDOW_ATTEMPTS = 3;

export type V2Phase =
  | "WINDOWS"
  | "CLARIFY"
  | "ANALYST_A"
  | "ANALYST_B"
  | "PERSIST";

export type V2CursorState = {
  kind: typeof V2_CURSOR_KIND;
  v: number;
  /** 输入指纹：文档集/内容哈希/页数/prompt 版本任一变化 → 旧检查点作废 */
  fingerprint: string;
  phase: V2Phase;
  /** 首个 tick 冻结的分析日期，保证跨 tick 的截止风险判定确定 */
  analysisDate: string;
  startedAt: string;
  /** 最近一次检查点时间：陈旧判定用它，而非 run.startedAt（否则重试额度被秒烧） */
  progressAt: string;
  ticks: number;
  windows: {
    /** windowId → 抽取输出（成功一次即永久缓存） */
    outputs: Record<string, ExtractionOutputV2>;
    /** windowId → 失败累计（attempts 达上限则永久排除并计入 limitations） */
    failures: Record<string, { attempts: number; lastErrorCode: string }>;
  };
  clarify: {
    /** plan item key → 解决检查结果（null = 已问过模型但未解决） */
    resolutions: Record<string, ResolutionOutputV2 | null>;
  };
  analyst: {
    passA: AnalystLlmOutput | null;
    passAErrorCode: string | null;
    passAAttempts: number;
    passB: AnalystQaOutput | null;
    passBErrorCode: string | null;
    passBAttempts: number;
    analystLatencyMs: number;
    reviewLatencyMs: number;
    /** Analyst 层日志与 grounding 日志分账（与单次编排的 telemetry 口径一致） */
    logs: LlmCallLog[];
  };
  /** grounding（窗口抽取 + 澄清解决检查）全 tick 累计日志 = result.metadata 的事实源 */
  logs: LlmCallLog[];
};

/** Analyst 单遍最大尝试次数（跨 tick 累计）：一次失败不该让中文综合层直接消失。 */
export const MAX_ANALYST_ATTEMPTS = 2;

export function computeV2Fingerprint(parts: {
  documents: { documentId: string; contentHash: string | null; pageCount: number }[];
  promptVersions: string[];
}): string {
  const docs = [...parts.documents]
    .sort((a, b) => a.documentId.localeCompare(b.documentId))
    .map((d) => `${d.documentId}:${d.contentHash ?? "-"}:${d.pageCount}`)
    .join("|");
  const prompts = [...parts.promptVersions].sort().join(",");
  return sha256Content(`v${V2_CURSOR_VERSION}#${docs}#${prompts}`);
}

export function createV2Cursor(args: {
  fingerprint: string;
  analysisDate: string;
  now: Date;
}): V2CursorState {
  const iso = args.now.toISOString();
  return {
    kind: V2_CURSOR_KIND,
    v: V2_CURSOR_VERSION,
    fingerprint: args.fingerprint,
    phase: "WINDOWS",
    analysisDate: args.analysisDate,
    startedAt: iso,
    progressAt: iso,
    ticks: 0,
    windows: { outputs: {}, failures: {} },
    clarify: { resolutions: {} },
    analyst: {
      passA: null,
      passAErrorCode: null,
      passAAttempts: 0,
      passB: null,
      passBErrorCode: null,
      passBAttempts: 0,
      analystLatencyMs: 0,
      reviewLatencyMs: 0,
      logs: [],
    },
    logs: [],
  };
}

/**
 * 读取既有游标：结构不符 / 版本不符 / 指纹不符（文档变了）→ null（从头开始）。
 * 宽进严出：任何形状异常都当作"无检查点"，绝不半信半疑地复用。
 */
export function parseV2Cursor(
  raw: unknown,
  expectedFingerprint: string,
): V2CursorState | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<V2CursorState>;
  if (c.kind !== V2_CURSOR_KIND) return null;
  if (c.v !== V2_CURSOR_VERSION) return null;
  if (typeof c.fingerprint !== "string" || c.fingerprint !== expectedFingerprint) {
    return null;
  }
  if (
    c.phase !== "WINDOWS" &&
    c.phase !== "CLARIFY" &&
    c.phase !== "ANALYST_A" &&
    c.phase !== "ANALYST_B" &&
    c.phase !== "PERSIST"
  ) {
    return null;
  }
  if (!c.windows || typeof c.windows !== "object") return null;
  if (!c.clarify || typeof c.clarify !== "object") return null;
  if (!c.analyst || typeof c.analyst !== "object") return null;
  if (!Array.isArray(c.logs)) return null;
  if (typeof c.analysisDate !== "string" || typeof c.startedAt !== "string") {
    return null;
  }

  return {
    kind: V2_CURSOR_KIND,
    v: V2_CURSOR_VERSION,
    fingerprint: c.fingerprint,
    phase: c.phase,
    analysisDate: c.analysisDate,
    startedAt: c.startedAt,
    progressAt:
      typeof c.progressAt === "string" ? c.progressAt : c.startedAt,
    ticks: typeof c.ticks === "number" && c.ticks >= 0 ? c.ticks : 0,
    windows: {
      outputs: (c.windows.outputs ?? {}) as Record<string, ExtractionOutputV2>,
      failures: (c.windows.failures ?? {}) as Record<
        string,
        { attempts: number; lastErrorCode: string }
      >,
    },
    clarify: {
      resolutions: (c.clarify.resolutions ?? {}) as Record<
        string,
        ResolutionOutputV2 | null
      >,
    },
    analyst: {
      passA: c.analyst.passA ?? null,
      passAErrorCode: c.analyst.passAErrorCode ?? null,
      passAAttempts: c.analyst.passAAttempts ?? 0,
      passB: c.analyst.passB ?? null,
      passBErrorCode: c.analyst.passBErrorCode ?? null,
      passBAttempts: c.analyst.passBAttempts ?? 0,
      analystLatencyMs: c.analyst.analystLatencyMs ?? 0,
      reviewLatencyMs: c.analyst.reviewLatencyMs ?? 0,
      logs: Array.isArray(c.analyst.logs) ? c.analyst.logs : [],
    },
    logs: c.logs as LlmCallLog[],
  };
}

/** 从任意 workerCursor 取最近检查点时间（陈旧扫描用；不校验指纹）。 */
export function readCursorProgressAt(raw: unknown): Date | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { kind?: unknown; progressAt?: unknown; startedAt?: unknown };
  if (c.kind !== V2_CURSOR_KIND) return null;
  const iso =
    typeof c.progressAt === "string"
      ? c.progressAt
      : typeof c.startedAt === "string"
        ? c.startedAt
        : null;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------ 时间预算（纯） ------------------------------ */

/** 每个阶段"值得开工"的剩余时间；不足则让出本 tick，下个 tick 满预算再来。 */
export const V2_PHASE_MIN_MS: Record<V2Phase, number> = {
  WINDOWS: 45_000,
  CLARIFY: 30_000,
  // Analyst 两遍是长调用（生产实测 PASS A ~159s / PASS B ~50s）：预算不足就别起头，
  // 否则只会烧掉一次调用又被硬杀，还可能把 timeout 裁到模型来不及输出。
  ANALYST_A: 180_000,
  ANALYST_B: 90_000,
  PERSIST: 60_000,
};

/** 调用超时相对剩余预算的安全余量（留给落盘/收尾/网络抖动） */
export const PHASE_SAFETY_MS = 15_000;

/** tick 预算本身就小于阶段门槛时的兜底：仍然尝试，否则该 run 永远无法推进。 */
export const HARD_MIN_PHASE_MS = 10_000;

export function remainingMs(deadlineAt: number, now: number): number {
  if (!Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return deadlineAt - now;
}

/**
 * 是否允许在本 tick 开始某阶段。
 * tickBudgetMs = 本次 cron 调用的完整预算：若它本身小于阶段门槛（如本地/测试环境
 * 给了很小的预算），退化为 HARD_MIN，保证有进展而不是死锁。
 */
export function canStartPhase(
  phase: V2Phase,
  remaining: number,
  tickBudgetMs: number,
): boolean {
  if (!Number.isFinite(remaining)) return true;
  const want = V2_PHASE_MIN_MS[phase];
  const threshold = tickBudgetMs >= want ? want : HARD_MIN_PHASE_MS;
  return remaining >= threshold;
}

/** 按剩余预算裁剪单次调用超时（上限仍由各阶段自身常量兜住）。 */
export function callTimeoutFor(remaining: number): number | undefined {
  if (!Number.isFinite(remaining)) return undefined;
  return Math.max(1_000, remaining - PHASE_SAFETY_MS);
}
