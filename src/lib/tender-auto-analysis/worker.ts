/**
 * TenderAnalysisRun 租约 worker（cron 分段推进，HTTP 不跑 LLM）
 *
 * workerStep 顺序对齐 Phase A constants.WORKER_STEPS：
 * CLAIMED → ENSURE_PAGES → EXTRACT_FACTS → GENERATE_SECTIONS →
 * EXTRACT_REQUIREMENTS → BUILD_DELIVERABLES → BUILD_CLARIFICATIONS →
 * CREATE_TASKS → PROJECT_ROOM → FINALIZE
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  WORKER_STEPS,
  type TenderAnalysisStatus,
  type WorkerStep,
} from "./constants";
import { canClaim, canTransition } from "./status";
import { parseDocumentPagesAndStore } from "./page-parse";
import { extractFromPages, extractRequirements } from "./extract";
import { generateReportSections } from "./report";
import { buildDeliverables } from "./deliverables";
import { buildClarifications } from "./clarifications";
import { analyzeAndPersistV2, isTenderAnalysisV2Enabled } from "./v2-persist";
import { projectAnalysisToRoom } from "./project-room";
import { createAnalysisTasks } from "./tasks";
import { computeAndPersistAddendumDiff } from "./addendum-diff";

export const LEASE_MS = 90_000;
/** 失败重试上限（仅 PENDING/FAILED 认领或 markFailed 时递增） */
export const MAX_ATTEMPTS = 5;
/** 单次 cron tick 内继续推进的时间预算；不足则交还队列 */
export const TIME_BUDGET_MS = 50_000;
/** 进行中但长期无进展的 Run 视为陈旧失败，防止无限续跑 */
export const STALE_RUN_MS = 30 * 60_000;

const RETRY_BACKOFF_MS = [15_000, 60_000, 180_000, 600_000, 1_800_000];

const STEP_ORDER: WorkerStep[] = [...WORKER_STEPS];

function stepIndex(step: string | null | undefined): number {
  if (!step) return -1;
  return STEP_ORDER.indexOf(step as WorkerStep);
}

function nextStep(current: string | null | undefined): WorkerStep | null {
  const idx = stepIndex(current);
  if (idx < 0) return STEP_ORDER[0] ?? null;
  if (idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1] ?? null;
}

export function sanitizeWorkerError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 800);
}

function leaseExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_MS);
}

function backoffMs(attemptCount: number): number {
  const idx = Math.max(0, Math.min(attemptCount - 1, RETRY_BACKOFF_MS.length - 1));
  return RETRY_BACKOFF_MS[idx] ?? 60_000;
}

async function renewLease(runId: string, leaseOwner: string): Promise<boolean> {
  const now = new Date();
  const updated = await db.tenderAnalysisRun.updateMany({
    where: {
      id: runId,
      leaseOwner,
      status: { in: ["EXTRACTING", "ANALYZING"] },
    },
    data: {
      leaseExpiresAt: leaseExpiresAt(now),
    },
  });
  return updated.count > 0;
}

async function persistStep(
  runId: string,
  leaseOwner: string,
  workerStep: WorkerStep,
  extra?: {
    status?: TenderAnalysisStatus;
    workerCursor?: unknown;
  },
): Promise<boolean> {
  const updated = await db.tenderAnalysisRun.updateMany({
    where: {
      id: runId,
      leaseOwner,
      // 已被 SUPERSEDED / APPROVED 等终结时禁止写回进行中状态
      status: { in: ["EXTRACTING", "ANALYZING"] },
    },
    data: {
      workerStep,
      leaseExpiresAt: leaseExpiresAt(),
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.workerCursor !== undefined
        ? { workerCursor: extra.workerCursor as object }
        : {}),
    },
  });
  return updated.count > 0;
}

async function markFailed(
  runId: string,
  attemptCount: number,
  error: unknown,
  errorCode = "worker_failed",
): Promise<void> {
  const now = new Date();
  // attemptCount 已在 PENDING/FAILED 认领时递增；此处不再二次 +1
  const exhausted = attemptCount >= MAX_ATTEMPTS;
  await db.tenderAnalysisRun.updateMany({
    where: {
      id: runId,
      status: { in: ["PENDING", "EXTRACTING", "ANALYZING", "FAILED"] },
    },
    data: {
      status: "FAILED",
      failedAt: now,
      errorCode,
      errorMessageSanitized: sanitizeWorkerError(error),
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: exhausted
        ? null
        : new Date(now.getTime() + backoffMs(attemptCount)),
      workerStep: null,
    },
  });
}

type ClaimedRun = {
  id: string;
  orgId: string;
  projectId: string;
  roomId: string | null;
  status: string;
  runKind: string;
  parentRunId: string | null;
  workerStep: string | null;
  attemptCount: number;
  createdById: string | null;
  leaseOwner: string;
};

class LeaseLostError extends Error {
  constructor(step: string) {
    super(`lease_lost_or_superseded at ${step}`);
    this.name = "LeaseLostError";
  }
}

async function claimRun(runId: string): Promise<ClaimedRun | null> {
  const now = new Date();
  const leaseOwner = `tender-worker:${randomUUID()}`;

  const current = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      orgId: true,
      projectId: true,
      roomId: true,
      status: true,
      runKind: true,
      parentRunId: true,
      workerStep: true,
      attemptCount: true,
      createdById: true,
      leaseExpiresAt: true,
      nextAttemptAt: true,
    },
  });
  if (!current) return null;
  if (current.attemptCount >= MAX_ATTEMPTS) return null;
  if (
    !canClaim({
      status: current.status as TenderAnalysisStatus,
      leaseExpiresAt: current.leaseExpiresAt,
      nextAttemptAt: current.nextAttemptAt,
    }, now)
  ) {
    return null;
  }

  const fromStatus = current.status as TenderAnalysisStatus;
  let toStatus: TenderAnalysisStatus = fromStatus;
  if (fromStatus === "PENDING" || fromStatus === "FAILED") {
    toStatus = "EXTRACTING";
  } else if (fromStatus === "EXTRACTING" || fromStatus === "ANALYZING") {
    toStatus = fromStatus;
  } else {
    return null;
  }

  if (fromStatus !== toStatus && !canTransition(fromStatus, toStatus)) {
    return null;
  }

  // attemptCount 只在新开跑 / 失败重试时递增；成功路径分段续跑不消耗重试额度
  const shouldIncrementAttempt =
    fromStatus === "PENDING" || fromStatus === "FAILED";

  const claimed = await db.tenderAnalysisRun.updateMany({
    where: {
      id: runId,
      status: fromStatus,
      attemptCount: current.attemptCount,
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
        { status: { in: ["PENDING", "FAILED"] } },
      ],
    },
    data: {
      status: toStatus,
      ...(shouldIncrementAttempt ? { attemptCount: { increment: 1 } } : {}),
      leaseOwner,
      leaseExpiresAt: leaseExpiresAt(now),
      nextAttemptAt: null,
      startedAt: current.status === "PENDING" ? now : undefined,
      errorCode: null,
      errorMessageSanitized: null,
      failedAt: null,
      workerStep: current.workerStep ?? "CLAIMED",
    },
  });

  if (claimed.count === 0) return null;

  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      orgId: true,
      projectId: true,
      roomId: true,
      status: true,
      runKind: true,
      parentRunId: true,
      workerStep: true,
      attemptCount: true,
      createdById: true,
      leaseOwner: true,
    },
  });
  if (!run?.leaseOwner) return null;
  return { ...run, leaseOwner: run.leaseOwner };
}

async function loadRunDocumentIds(runId: string): Promise<string[]> {
  const docs = await db.tenderAnalysisRunDocument.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: { documentId: true },
  });
  return docs.map((d) => d.documentId);
}

async function stepEnsurePages(run: ClaimedRun): Promise<void> {
  const documentIds = await loadRunDocumentIds(run.id);
  for (const documentId of documentIds) {
    const result = await parseDocumentPagesAndStore(documentId);
    if (!result.ok) {
      throw new Error(`ENSURE_PAGES failed: ${result.error}`);
    }
  }

  // Phase 1.1.1：整包页数上限（单文件上限仍由 MAX_PDF_PAGES 在 parse 内强制）
  const { MAX_TENDER_PACKAGE_PAGES } = await import("./package");
  const pageAgg = await db.projectDocument.findMany({
    where: { id: { in: documentIds } },
    select: { id: true, pageCount: true },
  });
  const totalPages = pageAgg.reduce(
    (sum, d) => sum + (typeof d.pageCount === "number" ? d.pageCount : 0),
    0,
  );
  if (totalPages > MAX_TENDER_PACKAGE_PAGES) {
    throw new Error(
      `PACKAGE_TOO_LARGE: package pages ${totalPages} > ${MAX_TENDER_PACKAGE_PAGES}`,
    );
  }

  const ok = await persistStep(run.id, run.leaseOwner, "ENSURE_PAGES", {
    status: "EXTRACTING",
  });
  if (!ok) throw new LeaseLostError("ENSURE_PAGES");
}

async function stepExtractFacts(run: ClaimedRun): Promise<void> {
  if (isTenderAnalysisV2Enabled()) {
    // V2 grounded 引擎：一步产出 facts+requirements+clarifications+sections+summary+addendum。
    // analyzeTender 为多 LLM 调用，可能超过 LEASE_MS → 执行期间心跳续租。
    const heartbeat = setInterval(() => {
      void renewLease(run.id, run.leaseOwner);
    }, 60_000);
    try {
      await analyzeAndPersistV2({
        runId: run.id,
        projectId: run.projectId,
        parentRunId: run.parentRunId,
      });
    } finally {
      clearInterval(heartbeat);
    }
  } else {
    const documentIds = await loadRunDocumentIds(run.id);
    await extractFromPages({ runId: run.id, documentIds });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "EXTRACT_FACTS", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("EXTRACT_FACTS");
}

async function stepGenerateSections(run: ClaimedRun): Promise<void> {
  // V2 ON：sections 已由 EXTRACT_FACTS 步写入 → no-op（仅推进 cursor）。
  if (!isTenderAnalysisV2Enabled()) {
    await generateReportSections({ runId: run.id });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "GENERATE_SECTIONS", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("GENERATE_SECTIONS");
}

async function stepExtractRequirements(run: ClaimedRun): Promise<void> {
  // V2 ON：requirements 已写入 → no-op。
  if (!isTenderAnalysisV2Enabled()) {
    await extractRequirements({ runId: run.id });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "EXTRACT_REQUIREMENTS", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("EXTRACT_REQUIREMENTS");
}

async function stepBuildDeliverables(run: ClaimedRun): Promise<void> {
  // V2 ON：不套 RCMP 固定交付物模板（防编造）；grounded submissionChecklist 落 summaryJson。
  if (!isTenderAnalysisV2Enabled()) {
    await buildDeliverables({ runId: run.id });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "BUILD_DELIVERABLES", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("BUILD_DELIVERABLES");
}

async function stepBuildClarifications(run: ClaimedRun): Promise<void> {
  // V2 ON：clarifications 已由 V2 写入（grounded，非 RCMP 模板）→ no-op。
  if (!isTenderAnalysisV2Enabled()) {
    await buildClarifications({ runId: run.id });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "BUILD_CLARIFICATIONS", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("BUILD_CLARIFICATIONS");
}

async function stepCreateTasks(run: ClaimedRun): Promise<void> {
  // V2 ON：不创建 RCMP 固定任务模板（背包工厂/DDP Regina 等，非本项目内容）；
  // grounded nextActions 落 summaryJson，供 Executive Brief 呈现。人工审阅经 REVIEW_REQUIRED。
  if (!isTenderAnalysisV2Enabled()) {
    await createAnalysisTasks({
      runId: run.id,
      projectId: run.projectId,
      orgId: run.orgId,
      createdById: run.createdById,
    });
  }
  const ok = await persistStep(run.id, run.leaseOwner, "CREATE_TASKS", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("CREATE_TASKS");
}

async function assertRunStillOwned(run: ClaimedRun): Promise<void> {
  const cur = await db.tenderAnalysisRun.findFirst({
    where: {
      id: run.id,
      leaseOwner: run.leaseOwner,
      status: { in: ["EXTRACTING", "ANALYZING"] },
    },
    select: { id: true },
  });
  if (!cur) throw new LeaseLostError("pre_side_effect");
}

async function stepProjectRoom(run: ClaimedRun): Promise<void> {
  // 副作用前再次确认未被 SUPERSEDE
  await assertRunStillOwned(run);

  // 增量分析：在投影前写出变更候选（骨架）
  if (run.runKind === "INCREMENTAL" && run.parentRunId) {
    await computeAndPersistAddendumDiff({
      runId: run.id,
      parentRunId: run.parentRunId,
      projectId: run.projectId,
      orgId: run.orgId,
    });
  }

  await projectAnalysisToRoom({
    runId: run.id,
    projectId: run.projectId,
    orgId: run.orgId,
    roomId: run.roomId,
  });
  const ok = await persistStep(run.id, run.leaseOwner, "PROJECT_ROOM", {
    status: "ANALYZING",
  });
  if (!ok) throw new LeaseLostError("PROJECT_ROOM");
}

async function stepFinalize(run: ClaimedRun): Promise<void> {
  const now = new Date();
  const from = (await db.tenderAnalysisRun.findUnique({
    where: { id: run.id },
    select: { status: true },
  }))?.status as TenderAnalysisStatus | undefined;

  if (from && from !== "REVIEW_REQUIRED" && !canTransition(from, "REVIEW_REQUIRED")) {
    throw new Error(`FINALIZE invalid transition ${from} → REVIEW_REQUIRED`);
  }

  const finalized = await db.tenderAnalysisRun.updateMany({
    where: {
      id: run.id,
      leaseOwner: run.leaseOwner,
      status: { in: ["EXTRACTING", "ANALYZING"] },
    },
    data: {
      status: "REVIEW_REQUIRED",
      workerStep: "FINALIZE",
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    },
  });
  if (finalized.count === 0) {
    throw new LeaseLostError("FINALIZE");
  }
}

async function runStep(run: ClaimedRun, step: WorkerStep): Promise<void> {
  switch (step) {
    case "CLAIMED": {
      const ok = await persistStep(run.id, run.leaseOwner, "CLAIMED", {
        status: "EXTRACTING",
      });
      if (!ok) throw new LeaseLostError("CLAIMED");
      return;
    }
    case "ENSURE_PAGES":
      await stepEnsurePages(run);
      return;
    case "EXTRACT_FACTS":
      await stepExtractFacts(run);
      return;
    case "GENERATE_SECTIONS":
      await stepGenerateSections(run);
      return;
    case "EXTRACT_REQUIREMENTS":
      await stepExtractRequirements(run);
      return;
    case "BUILD_DELIVERABLES":
      await stepBuildDeliverables(run);
      return;
    case "BUILD_CLARIFICATIONS":
      await stepBuildClarifications(run);
      return;
    case "CREATE_TASKS":
      await stepCreateTasks(run);
      return;
    case "PROJECT_ROOM":
      await stepProjectRoom(run);
      return;
    case "FINALIZE":
      await stepFinalize(run);
      return;
    default:
      throw new Error(`Unknown workerStep: ${step}`);
  }
}

/**
 * 执行单个已认领 Run：按 workerStep 推进，时间预算不足则提前返回。
 * 失败时标 FAILED + backoff，不向 batch 抛出。
 */
export async function executeTenderAnalysisRun(runId: string): Promise<{
  runId: string;
  status: string | null;
  workerStep: string | null;
  ok: boolean;
  reason?: string;
}> {
  const claimed = await claimRun(runId);
  if (!claimed) {
    const cur = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: { status: true, workerStep: true },
    });
    return {
      runId,
      status: cur?.status ?? null,
      workerStep: cur?.workerStep ?? null,
      ok: false,
      reason: "not_claimable",
    };
  }

  const started = Date.now();
  try {
    let cursorStep: string | null = claimed.workerStep;

    // 若尚无步骤，从 CLAIMED 开始
    if (!cursorStep) {
      await runStep(claimed, "CLAIMED");
      cursorStep = "CLAIMED";
    } else if (stepIndex(cursorStep) < 0) {
      await runStep(claimed, "CLAIMED");
      cursorStep = "CLAIMED";
    }

    // 当前已持久化的 step 视为完成，推进下一步
    while (Date.now() - started < TIME_BUDGET_MS) {
      const renewed = await renewLease(claimed.id, claimed.leaseOwner);
      if (!renewed) {
        return {
          runId: claimed.id,
          status: null,
          workerStep: cursorStep,
          ok: false,
          reason: "lease_lost",
        };
      }

      const upcoming = nextStep(cursorStep);
      if (!upcoming) break;

      await runStep(claimed, upcoming);
      cursorStep = upcoming;

      if (upcoming === "FINALIZE") {
        break;
      }
    }

    const latest = await db.tenderAnalysisRun.findUnique({
      where: { id: claimed.id },
      select: { status: true, workerStep: true, leaseOwner: true },
    });

    // 未终态则释放租约，留给下次 cron（保持 EXTRACTING/ANALYZING）
    if (
      latest &&
      latest.status !== "REVIEW_REQUIRED" &&
      latest.status !== "FAILED" &&
      latest.status !== "SUPERSEDED" &&
      latest.leaseOwner === claimed.leaseOwner
    ) {
      await db.tenderAnalysisRun.updateMany({
        where: { id: claimed.id, leaseOwner: claimed.leaseOwner },
        data: {
          leaseOwner: null,
          leaseExpiresAt: new Date(), // 立即过期，便于下次认领
        },
      });
    }

    return {
      runId: claimed.id,
      status: latest?.status ?? null,
      workerStep: latest?.workerStep ?? cursorStep,
      ok: true,
    };
  } catch (error) {
    if (error instanceof LeaseLostError) {
      return {
        runId: claimed.id,
        status: null,
        workerStep: claimed.workerStep,
        ok: false,
        reason: "lease_lost",
      };
    }
    await markFailed(claimed.id, claimed.attemptCount, error);
    return {
      runId: claimed.id,
      status: "FAILED",
      workerStep: null,
      ok: false,
      reason: sanitizeWorkerError(error),
    };
  }
}

/** cron / worker 批量消费 */
export async function processQueuedTenderAnalysisRuns(limit = 1): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  runIds: string[];
  results: Array<{
    runId: string;
    status: string | null;
    workerStep: string | null;
    ok: boolean;
    reason?: string;
  }>;
}> {
  const now = new Date();
  const take = Math.max(1, Math.min(limit, 2));

  // 租约过期且失败重试耗尽 → FAILED
  await db.tenderAnalysisRun.updateMany({
    where: {
      status: { in: ["EXTRACTING", "ANALYZING"] },
      attemptCount: { gte: MAX_ATTEMPTS },
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: "FAILED",
      errorCode: "lease_exhausted",
      errorMessageSanitized: "分析任务超时且已达最大尝试次数",
      leaseOwner: null,
      leaseExpiresAt: null,
      failedAt: now,
    },
  });

  // 长期无进展的进行中 Run → FAILED（防止成功续跑路径无限占用）
  await db.tenderAnalysisRun.updateMany({
    where: {
      status: { in: ["EXTRACTING", "ANALYZING"] },
      leaseExpiresAt: { lte: now },
      OR: [
        { startedAt: { lte: new Date(now.getTime() - STALE_RUN_MS) } },
        {
          startedAt: null,
          createdAt: { lte: new Date(now.getTime() - STALE_RUN_MS) },
        },
      ],
    },
    data: {
      status: "FAILED",
      errorCode: "stale_run",
      errorMessageSanitized: "分析任务长时间无进展，已标记失败",
      leaseOwner: null,
      leaseExpiresAt: null,
      failedAt: now,
      nextAttemptAt: null,
    },
  });

  // 多取候选：单个 not_claimable / 永久失败不得阻塞同批其它 Run
  const candidates = await db.tenderAnalysisRun.findMany({
    where: {
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: "PENDING",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: "FAILED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: "EXTRACTING",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        {
          status: "ANALYZING",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
      ],
    },
    // PENDING 优先，避免 FAILED 重试饿死新任务
    orderBy: [{ createdAt: "asc" }],
    take: Math.max(take * 8, 8),
    select: { id: true, status: true },
  });
  candidates.sort((a, b) => {
    const rank = (s: string) =>
      s === "PENDING" ? 0 : s === "EXTRACTING" || s === "ANALYZING" ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });

  const results = [];
  for (const row of candidates) {
    if (results.length >= take) break;
    try {
      const result = await executeTenderAnalysisRun(row.id);
      if (result.reason === "not_claimable") continue;
      results.push(result);
    } catch (error) {
      // 单条异常不得打断 batch
      results.push({
        runId: row.id,
        status: "FAILED",
        workerStep: null,
        ok: false,
        reason: sanitizeWorkerError(error),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok && r.reason !== "not_claimable").length;

  return {
    processed: results.length,
    succeeded,
    failed,
    runIds: candidates.map((c) => c.id),
    results,
  };
}
