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
import { PARSE_VERSION } from "./constants";
import { canClaim, canTransition } from "./status";
import { parseDocumentPagesAndStore } from "./page-parse";
import { extractFromPages, extractRequirements } from "./extract";
import { generateReportSections } from "./report";
import { buildDeliverables } from "./deliverables";
import { buildClarifications } from "./clarifications";
import {
  advanceAndPersistV2,
  isEmptyAnalysisOutcome,
  isTenderAnalysisV2Enabled,
  TenderV2LeaseLostError,
} from "./v2-persist";
import { readCursorProgressAt, type V2CursorState } from "./v2-cursor";
import { notifyTenderRunFailed, notifyTenderRunSucceeded } from "./alerts";
import { projectAnalysisToRoom } from "./project-room";
import { createAnalysisTasks } from "./tasks";
import { computeAndPersistAddendumDiff } from "./addendum-diff";

/**
 * 租约时长必须 ≥ 单次 cron 调用可能占用的最长时间（INVOCATION_BUDGET_MS），
 * 否则长阶段跑到一半租约就过期，下个 tick 会重复认领同一 run 并重复烧 LLM。
 * 代价是进程被硬杀后最多等 LEASE_MS 才被接管——检查点保证零重复工作，值得。
 */
export const LEASE_MS = 300_000;
/** 失败重试上限（仅 PENDING/FAILED 认领或 markFailed 时递增） */
export const MAX_ATTEMPTS = 5;
/**
 * 单次 cron 调用的工作预算。必须显著小于函数 maxDuration（vercel.json：300s），
 * 留够余量把检查点写完——否则被 serverless 硬杀，本 tick 的 LLM 成果全丢。
 */
export const INVOCATION_BUDGET_MS = 240_000;
/** 剩余预算低于此值就不再开始下一个 run（避免刚起头就被截断） */
export const MIN_RUN_SLICE_MS = 45_000;
/** 剩余预算低于此值就不再开始下一个 step（DB 步很快，但 FINALIZE 含外部检索） */
export const MIN_STEP_SLICE_MS = 5_000;
/** ENSURE_PAGES 每份文档开工所需的最小剩余预算 */
export const ENSURE_PAGES_MIN_MS = 30_000;
/** 长阶段内的租约心跳间隔 */
export const HEARTBEAT_MS = 30_000;
/** 进行中但长期无进展的 Run 视为陈旧失败，防止无限续跑 */
export const STALE_RUN_MS = 30 * 60_000;

/** 单个 run 在一次 cron 调用中的执行上下文（时间预算 = 唯一的推进闸门） */
type TickContext = {
  /** epoch ms 硬截止 */
  deadlineAt: number;
  /** 本次 cron 调用的完整预算（阶段准入退化判定用） */
  tickBudgetMs: number;
  now: () => number;
};

function remainingOf(ctx: TickContext): number {
  return Number.isFinite(ctx.deadlineAt)
    ? ctx.deadlineAt - ctx.now()
    : Number.POSITIVE_INFINITY;
}

/** 步骤结果：DONE=已推进 cursor；YIELD=预算用尽，检查点已落，留给下个 tick */
type StepResult = "DONE" | "YIELD";

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

  // 只在**终态**告警：还会自动重试的失败不打扰用户
  if (exhausted) await notifyTenderRunFailed(runId);
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

async function loadRunDocuments(
  runId: string,
): Promise<{ documentId: string; contentHash: string }[]> {
  const docs = await db.tenderAnalysisRunDocument.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: { documentId: true, contentHash: true },
  });
  return docs.map((d) => ({ documentId: d.documentId, contentHash: d.contentHash }));
}

/**
 * 该文档的页级解析是否已是当前版本且与 run 记录的内容哈希一致。
 * 是 → 本 tick 直接跳过（ENSURE_PAGES 因此天然可续跑，重试不重复下载/解析）。
 */
async function isPageParseCurrent(
  documentId: string,
  expectedContentHash: string | null,
): Promise<boolean> {
  const doc = await db.projectDocument.findUnique({
    where: { id: documentId },
    select: {
      parseStatus: true,
      parseVersion: true,
      contentHash: true,
      fileType: true,
      _count: { select: { pages: true } },
    },
  });
  if (!doc) return false;
  if (doc.parseStatus !== "done") return false;
  if (doc.parseVersion !== PARSE_VERSION) return false;
  if (
    expectedContentHash &&
    doc.contentHash &&
    doc.contentHash !== expectedContentHash
  ) {
    return false;
  }
  // PDF 必须有页级行；非 PDF 不造页行（pageCount=null 合法）
  if (doc.fileType.toLowerCase() === "pdf" && doc._count.pages <= 0) return false;
  return true;
}

async function stepEnsurePages(
  run: ClaimedRun,
  ctx: TickContext,
): Promise<StepResult> {
  const runDocs = await loadRunDocuments(run.id);
  const documentIds = runDocs.map((d) => d.documentId);
  for (const doc of runDocs) {
    if (await isPageParseCurrent(doc.documentId, doc.contentHash)) continue;
    if (remainingOf(ctx) < ENSURE_PAGES_MIN_MS) {
      // 已解析的文档已落库；下个 tick 从未解析的那份继续（不重复解析）
      return "YIELD";
    }
    const result = await parseDocumentPagesAndStore(doc.documentId);
    if (!result.ok) {
      throw new Error(`ENSURE_PAGES failed: ${result.error}`);
    }
    if (!(await renewLease(run.id, run.leaseOwner))) {
      throw new LeaseLostError("ENSURE_PAGES");
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
  return "DONE";
}

/** 检查点体积告警阈值（单行 jsonb）：超过即在日志显形，便于评估分片粒度 */
export const CURSOR_SIZE_WARN_BYTES = 4 * 1024 * 1024;

/** 检查点落盘：与 persistStep 同一把 lease fence；顺带续租（进展即心跳）。 */
async function saveV2Cursor(
  runId: string,
  leaseOwner: string,
  cursor: V2CursorState,
): Promise<boolean> {
  const serialized = JSON.stringify(cursor);
  if (serialized.length > CURSOR_SIZE_WARN_BYTES) {
    console.warn(
      `[tender-v2-resumable] run=${runId} cursor_bytes=${serialized.length} phase=${cursor.phase} 检查点偏大`,
    );
  }
  const updated = await db.tenderAnalysisRun.updateMany({
    where: {
      id: runId,
      leaseOwner,
      status: { in: ["EXTRACTING", "ANALYZING"] },
    },
    data: {
      workerCursor: JSON.parse(serialized) as object,
      leaseExpiresAt: leaseExpiresAt(),
    },
  });
  return updated.count > 0;
}

async function stepExtractFacts(
  run: ClaimedRun,
  ctx: TickContext,
): Promise<StepResult> {
  if (isTenderAnalysisV2Enabled()) {
    // V2 grounded 引擎：分片续跑（每次 LLM 结果立即检查点）。推理与 canonical 写分离；
    // 本 tick 预算用尽 → YIELD，run 保持 EXTRACTING、workerStep 不前进，下个 cron 从断点继续。
    // 心跳续租；renewLease 返回 false 记 leaseLost，落库前 fail-closed（不写）。
    // 权威防线仍是 persistV2Fenced / saveCursor 的 lease fence（stale worker 零写）。
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void renewLease(run.id, run.leaseOwner).then((okLease) => {
        if (!okLease) leaseLost = true;
      });
    }, HEARTBEAT_MS);
    try {
      const current = await db.tenderAnalysisRun.findUnique({
        where: { id: run.id },
        select: { workerCursor: true },
      });
      const outcome = await advanceAndPersistV2({
        runId: run.id,
        projectId: run.projectId,
        parentRunId: run.parentRunId,
        leaseOwner: run.leaseOwner,
        leaseMs: LEASE_MS,
        deadlineAt: ctx.deadlineAt,
        tickBudgetMs: ctx.tickBudgetMs,
        cursorRaw: current?.workerCursor ?? null,
        saveCursor: (cursor) => saveV2Cursor(run.id, run.leaseOwner, cursor),
        checkLease: () => !leaseLost,
        now: ctx.now,
      });

      if (outcome.status === "YIELD") {
        console.log(
          `[tender-v2-resumable] run=${run.id} yield phase=${outcome.phase} tick=${outcome.ticks} ${outcome.reason}`,
        );
        return "YIELD";
      }

      // FB-18：空壳分析（零成功模型调用且零产出）必须 FAIL，不得进入审核态
      if (isEmptyAnalysisOutcome(outcome.result)) {
        throw new Error(
          `empty_analysis_zero_llm_success: 模型调用全部失败（${outcome.result.llmFailures}/${outcome.result.llmCalls}）且无抽取产出，分析无效`,
        );
      }
    } catch (e) {
      // V2 fence 拒绝（stale worker）→ 转为 worker 的 graceful yield（不 markFailed）
      if (e instanceof TenderV2LeaseLostError) {
        throw new LeaseLostError("EXTRACT_FACTS_v2_fence");
      }
      throw e;
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
  return "DONE";
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

  // 分析可用了要有人知道（与失败告警对称）：幂等 + best-effort，绝不阻断收尾
  await notifyTenderRunSucceeded(run.id);

  // 业务阶段推进（FB-7）：AI 解读产出（REVIEW_REQUIRED）即代表项目进入「项目解读」，
  // 不要求先做项目分发（默认使用者即项目负责人）。幂等：已有 interpretedAt 不覆盖。
  await db.project
    .updateMany({
      where: { id: run.projectId, interpretedAt: null },
      data: { interpretedAt: now },
    })
    .catch(() => undefined);

  // M1.1：立项自动外部检索（分析一完成即多线检索历史授标并交叉验证；
  // 结果仅作候选存入调查室，人工确认门不变；flag OFF 时零出站）
  try {
    const { isExternalIntelEnabled, deriveAwardQueries, autoSearchAwardHistory } =
      await import("@/lib/tender-intel/canadabuys");
    if (isExternalIntelEnabled()) {
      const cur = await db.tenderAnalysisRun.findUnique({
        where: { id: run.id },
        select: { summaryJson: true },
      });
      const sj = (cur?.summaryJson as Record<string, unknown>) ?? {};
      const syn = sj.analystSynthesis as
        | { executiveBrief?: { whatIsBeingBoughtZh?: string }; scope?: { deliverables?: string[] } }
        | undefined;
      const brief = sj.brief as { buyer?: string | null } | undefined;
      const proj = await db.project.findUnique({
        where: { id: run.projectId },
        select: { name: true },
      });
      const queries = deriveAwardQueries({
        projectName: proj?.name ?? null,
        buyerText: brief?.buyer ?? null,
        productTexts: [
          syn?.executiveBrief?.whatIsBeingBoughtZh ?? "",
          ...(syn?.scope?.deliverables ?? []),
        ],
      });
      const auto =
        queries.length > 0 ? await autoSearchAwardHistory({ queries }) : null;

      // M2：Web 多线检索（中标方线/产品+机构线/招标编号线）——同一契约
      const { deriveWebQueries, autoWebIntel } = await import(
        "@/lib/tender-intel/websearch"
      );
      const roomBefore = await db.bidIntelligenceRoom.findUnique({
        where: { projectId: run.projectId },
        select: { id: true, summaryJson: true },
      });
      const rsj0 = (roomBefore?.summaryJson as Record<string, unknown>) ?? {};
      const confirmed = rsj0.externalConfirmed as
        | { previousWinner?: string | null }
        | undefined;
      const solNum = await db.project.findUnique({
        where: { id: run.projectId },
        select: { solicitationNumber: true },
      });
      const webQueries = deriveWebQueries({
        confirmedWinner: confirmed?.previousWinner ?? null,
        productPhrase: queries[0] ?? null,
        buyerPhrase: queries.find((q) => /general|ministry|department|city|university/i.test(q)) ?? null,
        solicitationNumber: solNum?.solicitationNumber ?? null,
      });
      const web = webQueries.length > 0 ? await autoWebIntel({ queries: webQueries }) : null;

      if ((auto?.ok || web?.ok) && roomBefore) {
        // M2.5：AI 分析师读检索结果 → 中文结论（八模块直接可读；仍属 AI 初步调查）
        let externalAnalysis: unknown = null;
        try {
          const { analyzeExternalIntel } = await import("@/lib/tender-intel/analyze");
          const briefBlock = (
            (await db.tenderAnalysisRun.findUnique({
              where: { id: run.id },
              select: { summaryJson: true },
            }))?.summaryJson as Record<string, unknown>
          )?.brief as { oneLiner?: string | null } | undefined;
          const { analysis } = await analyzeExternalIntel({
            projectOneLiner: briefBlock?.oneLiner ?? null,
            awardCandidates: auto?.candidates ?? [],
            webCandidates: web?.candidates ?? [],
          });
          externalAnalysis = analysis;
        } catch {
          externalAnalysis = null;
        }
        await db.bidIntelligenceRoom.update({
          where: { id: roomBefore.id },
          data: {
            summaryJson: JSON.parse(
              JSON.stringify({
                ...rsj0,
                ...(auto?.ok ? { externalCandidates: auto } : {}),
                ...(web?.ok ? { webIntel: web } : {}),
                ...(externalAnalysis ? { externalAnalysis } : {}),
              }),
            ),
          },
        });
        console.log(
          `[tender-external-intel] project=${run.projectId} award_candidates=${auto?.candidates.length ?? 0} web_domains=${web?.candidates.length ?? 0} analyzed=${externalAnalysis ? 1 : 0}`,
        );
      }
    }
  } catch {
    /* 外部检索失败不影响分析结果 */
  }

  // FB-15：业主回复自动关联（best-effort，与 auto-enqueue 同模式，绝不阻断分析）
  try {
    const { resolveOwnerReplies } = await import("./reply-resolution");
    const rr = await resolveOwnerReplies({ projectId: run.projectId });
    if (rr.checked > 0) {
      console.log(
        `[tender-reply-resolution] project=${run.projectId} checked=${rr.checked} resolved=${rr.resolved}`,
      );
    }
  } catch {
    /* 回复匹配失败不影响分析结果 */
  }
}

async function runStep(
  run: ClaimedRun,
  step: WorkerStep,
  ctx: TickContext,
): Promise<StepResult> {
  switch (step) {
    case "CLAIMED": {
      const ok = await persistStep(run.id, run.leaseOwner, "CLAIMED", {
        status: "EXTRACTING",
      });
      if (!ok) throw new LeaseLostError("CLAIMED");
      return "DONE";
    }
    case "ENSURE_PAGES":
      return stepEnsurePages(run, ctx);
    case "EXTRACT_FACTS":
      return stepExtractFacts(run, ctx);
    case "GENERATE_SECTIONS":
      await stepGenerateSections(run);
      return "DONE";
    case "EXTRACT_REQUIREMENTS":
      await stepExtractRequirements(run);
      return "DONE";
    case "BUILD_DELIVERABLES":
      await stepBuildDeliverables(run);
      return "DONE";
    case "BUILD_CLARIFICATIONS":
      await stepBuildClarifications(run);
      return "DONE";
    case "CREATE_TASKS":
      await stepCreateTasks(run);
      return "DONE";
    case "PROJECT_ROOM":
      await stepProjectRoom(run);
      return "DONE";
    case "FINALIZE":
      await stepFinalize(run);
      return "DONE";
    default:
      throw new Error(`Unknown workerStep: ${step}`);
  }
}

/**
 * 执行单个已认领 Run：按 workerStep 推进，时间预算不足则提前返回。
 * 失败时标 FAILED + backoff，不向 batch 抛出。
 *
 * opts.deadlineAt 是本次 cron 调用的硬截止（epoch ms）。缺省时按 INVOCATION_BUDGET_MS
 * 从当下起算——脚本/测试直接调用本函数时行为与 cron 一致。
 */
export async function executeTenderAnalysisRun(
  runId: string,
  opts?: { deadlineAt?: number; tickBudgetMs?: number; now?: () => number },
): Promise<{
  runId: string;
  status: string | null;
  workerStep: string | null;
  ok: boolean;
  reason?: string;
}> {
  const now = opts?.now ?? (() => Date.now());
  const ctx: TickContext = {
    deadlineAt: opts?.deadlineAt ?? now() + INVOCATION_BUDGET_MS,
    tickBudgetMs: opts?.tickBudgetMs ?? INVOCATION_BUDGET_MS,
    now,
  };
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

  try {
    let cursorStep: string | null = claimed.workerStep;

    // 若尚无步骤，从 CLAIMED 开始
    if (!cursorStep || stepIndex(cursorStep) < 0) {
      await runStep(claimed, "CLAIMED", ctx);
      cursorStep = "CLAIMED";
    }

    // 当前已持久化的 step 视为完成，推进下一步；预算耗尽即交还队列（下个 tick 续跑）
    while (remainingOf(ctx) > MIN_STEP_SLICE_MS) {
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

      const stepResult = await runStep(claimed, upcoming, ctx);
      if (stepResult === "YIELD") {
        // 分片续跑：检查点已落盘，本 run 保持进行中，等下个 cron tick
        break;
      }
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

/**
 * 陈旧判定（纯函数）：分片续跑下"有没有进展"必须看**检查点时间**，
 * 而不是 run.startedAt——后者在重试时不重置，一旦超过 STALE_RUN_MS 就会对每次
 * 租约过期立刻命中，把 5 次重试额度在几分钟内烧光（2026-08-15 生产事故的放大器）。
 */
export function isRunStale(
  run: {
    startedAt: Date | null;
    createdAt: Date;
    workerCursor: unknown;
  },
  now: Date,
  staleMs = STALE_RUN_MS,
): boolean {
  const progressAt =
    readCursorProgressAt(run.workerCursor) ?? run.startedAt ?? run.createdAt;
  return now.getTime() - progressAt.getTime() >= staleMs;
}

/** cron / worker 批量消费 */
export async function processQueuedTenderAnalysisRuns(
  limit = 1,
  opts?: { deadlineAt?: number; tickBudgetMs?: number },
): Promise<{
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
  const exhaustedIds = (
    await db.tenderAnalysisRun.findMany({
      where: {
        status: { in: ["EXTRACTING", "ANALYZING"] },
        attemptCount: { gte: MAX_ATTEMPTS },
        leaseExpiresAt: { lte: now },
      },
      select: { id: true },
      take: 50,
    })
  ).map((r) => r.id);
  if (exhaustedIds.length > 0) {
    await db.tenderAnalysisRun.updateMany({
      where: { id: { in: exhaustedIds } },
      data: {
        status: "FAILED",
        errorCode: "lease_exhausted",
        errorMessageSanitized: "分析任务超时且已达最大尝试次数",
        leaseOwner: null,
        leaseExpiresAt: null,
        failedAt: now,
      },
    });
    for (const id of exhaustedIds) await notifyTenderRunFailed(id);
  }

  // 长期**无进展**的进行中 Run → FAILED（防止无限续跑占用）。
  // 候选先按 startedAt/createdAt 粗筛（走索引），再按检查点时间精判：
  // 只要还在推进检查点（每次 LLM 调用后都写），就不算陈旧。
  const staleCandidates = await db.tenderAnalysisRun.findMany({
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
    select: { id: true, startedAt: true, createdAt: true, workerCursor: true },
    take: 50,
  });
  const staleIds = staleCandidates
    .filter((r) => isRunStale(r, now))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    await db.tenderAnalysisRun.updateMany({
      where: {
        id: { in: staleIds },
        status: { in: ["EXTRACTING", "ANALYZING"] },
        leaseExpiresAt: { lte: now },
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
    for (const id of staleIds) await notifyTenderRunFailed(id);
  }

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

  // 本次调用的硬预算：多个 run 共享同一条截止线，避免"两个 run 各跑 240s"
  // 把函数拖过 maxDuration（被硬杀 = 本 tick 全部成果丢失）。
  const tickBudgetMs = opts?.tickBudgetMs ?? INVOCATION_BUDGET_MS;
  const deadlineAt = opts?.deadlineAt ?? Date.now() + tickBudgetMs;

  const results = [];
  let skippedForBudget = 0;
  for (const row of candidates) {
    if (results.length >= take) break;
    if (deadlineAt - Date.now() < MIN_RUN_SLICE_MS) {
      skippedForBudget += 1;
      continue;
    }
    try {
      const result = await executeTenderAnalysisRun(row.id, {
        deadlineAt,
        tickBudgetMs,
      });
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

  if (skippedForBudget > 0) {
    // 可观测性：没有静默截断——被预算挡下的候选下个 tick 会被再取一次
    console.log(
      `[tender-worker] deferred=${skippedForBudget} reason=invocation_budget budget_ms=${tickBudgetMs}`,
    );
  }

  return {
    processed: results.length,
    succeeded,
    failed,
    runIds: candidates.map((c) => c.id),
    results,
  };
}
