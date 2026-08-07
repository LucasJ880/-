/**
 * Phase 1.1.1 — 以 Tender Package 为单位入队 FULL Run
 */

import { db } from "@/lib/db";
import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  REANALYZE_RATE_MAX,
  REANALYZE_RATE_WINDOW_MS,
  type TenderAnalysisStatus,
} from "./constants";
import { canAutoEnqueueAnalysis } from "./gate";
import { buildIdempotencyKey } from "./idempotency";
import {
  ACTIVE_RUN_STATUSES,
  shouldSupersedeActiveRun,
  SUPERSEDABLE_RUN_STATUSES,
} from "./enqueue-helpers";
import {
  computePackageFingerprint,
  detectMultiplePrimaryWarning,
  getTenderPackageDocuments,
  MAX_TENDER_PACKAGE_PAGES,
  packageTooLarge,
  type PackageDocument,
} from "./package";

export type EnqueuePackageInput = {
  projectId: string;
  userId: string;
  orgId?: string;
  /** 强制纳入的 documentId（刚上传） */
  forceIncludeDocumentIds?: string[];
  /**
   * reanalyze：即使 fingerprint 与 REVIEW_REQUIRED 相同，也强制新跑
   * （仍遵守 rate limit / 不碰 APPROVED 状态）
   */
  forceNewRun?: boolean;
};

export type EnqueuePackageResult = {
  enqueued: boolean;
  runId?: string;
  status?: TenderAnalysisStatus | string;
  reason?: string;
  documentCount?: number;
  packageFingerprint?: string;
  classificationWarning?: string | null;
  supersededRunIds?: string[];
  suggestion?: "mark_as_tender";
};

async function findActiveByFingerprint(input: {
  projectId: string;
  fingerprint: string;
  idempotencyKey: string;
}) {
  return db.tenderAnalysisRun.findFirst({
    where: {
      projectId: input.projectId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      OR: [
        { idempotencyKey: input.idempotencyKey },
        { sourceHashFingerprint: input.fingerprint },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      idempotencyKey: true,
      sourceHashFingerprint: true,
    },
  });
}

async function resolveLineageRunId(projectId: string): Promise<string | null> {
  const latest = await db.tenderAnalysisRun.findFirst({
    where: {
      projectId,
      status: { in: ["REVIEW_REQUIRED", "APPROVED", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

async function supersedeInFlightRuns(input: {
  projectId: string;
  newFingerprint: string;
  newRunId: string;
}): Promise<string[]> {
  const candidates = await db.tenderAnalysisRun.findMany({
    where: {
      projectId: input.projectId,
      status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
      id: { not: input.newRunId },
    },
    select: {
      id: true,
      status: true,
      sourceHashFingerprint: true,
    },
  });

  const ids: string[] = [];
  for (const old of candidates) {
    if (
      !shouldSupersedeActiveRun({
        existingFingerprint: old.sourceHashFingerprint,
        newFingerprint: input.newFingerprint,
        existingStatus: old.status,
      })
    ) {
      continue;
    }
    const updated = await db.tenderAnalysisRun.updateMany({
      where: {
        id: old.id,
        status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
      },
      data: {
        status: "SUPERSEDED",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    if (updated.count > 0) ids.push(old.id);
  }
  return ids;
}

/**
 * 创建 FULL Run，绑定当前 package 全部有效文档。
 */
export async function enqueueTenderPackageAnalysis(
  input: EnqueuePackageInput,
): Promise<EnqueuePackageResult> {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      orgId: true,
      workDomain: true,
      intelligenceRoom: { select: { id: true } },
    },
  });
  if (!project) {
    return { enqueued: false, reason: "project_not_found" };
  }

  const orgId = (project.orgId ?? input.orgId ?? "").trim();
  if (!orgId) {
    return { enqueued: false, reason: "missing_org" };
  }

  const gate = canAutoEnqueueAnalysis({
    workDomain: project.workDomain,
    hasIntelligenceRoom: Boolean(project.intelligenceRoom),
  });
  if (!gate.ok) {
    return {
      enqueued: false,
      reason: gate.reason,
      suggestion: "mark_as_tender",
    };
  }

  const docs = await getTenderPackageDocuments(input.projectId, {
    forceIncludeDocumentIds: input.forceIncludeDocumentIds,
  });
  if (docs.length === 0) {
    return { enqueued: false, reason: "no_package_documents" };
  }

  if (packageTooLarge(docs)) {
    return {
      enqueued: false,
      reason: "PACKAGE_TOO_LARGE",
      documentCount: docs.length,
      packageFingerprint: computePackageFingerprint(docs),
    };
  }

  const fingerprint = computePackageFingerprint(docs);
  const idempotencyKey = buildIdempotencyKey({
    projectId: input.projectId,
    fingerprint,
    promptVersion: PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
  });

  if (!input.forceNewRun) {
    const existing = await findActiveByFingerprint({
      projectId: input.projectId,
      fingerprint,
      idempotencyKey,
    });
    if (existing) {
      return {
        enqueued: false,
        runId: existing.id,
        status: existing.status,
        reason: "idempotent_reuse",
        documentCount: docs.length,
        packageFingerprint: fingerprint,
        classificationWarning: detectMultiplePrimaryWarning(docs),
      };
    }
  }

  // forceNewRun：仍阻止并发 in-flight
  const inFlight = await db.tenderAnalysisRun.findFirst({
    where: {
      projectId: input.projectId,
      status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
    },
    select: { id: true, sourceHashFingerprint: true, status: true },
  });
  // in-flight 不同 fingerprint 将在创建后 SUPERSEDE；同 fingerprint 且 force 则仍创建（reanalyze）

  const lineageId = await resolveLineageRunId(input.projectId);
  const warning = detectMultiplePrimaryWarning(docs);

  let run;
  try {
    run = await db.tenderAnalysisRun.create({
      data: {
        orgId,
        projectId: input.projectId,
        roomId: project.intelligenceRoom?.id ?? null,
        status: "PENDING",
        runKind: "FULL",
        analysisVersion: ANALYSIS_VERSION,
        promptVersion: PROMPT_VERSION,
        idempotencyKey: input.forceNewRun
          ? buildIdempotencyKey({
              projectId: input.projectId,
              fingerprint: `${fingerprint}:reanalyze:${Date.now()}`,
              promptVersion: PROMPT_VERSION,
              analysisVersion: ANALYSIS_VERSION,
            })
          : idempotencyKey,
        sourceHashFingerprint: fingerprint,
        createdById: input.userId,
        parentRunId: null,
        supersedesRunId: lineageId,
        nextAttemptAt: new Date(),
        summaryJson: warning
          ? { classificationWarning: warning, documentCount: docs.length }
          : { documentCount: docs.length },
        documents: {
          create: docs.map((d: PackageDocument) => ({
            documentId: d.documentId,
            contentHash: d.contentHash,
            role: d.role,
          })),
        },
      },
      select: { id: true, status: true },
    });
  } catch (err) {
    if (!input.forceNewRun) {
      const raced = await findActiveByFingerprint({
        projectId: input.projectId,
        fingerprint,
        idempotencyKey,
      });
      if (raced) {
        return {
          enqueued: false,
          runId: raced.id,
          status: raced.status,
          reason: "idempotent_reuse",
          documentCount: docs.length,
          packageFingerprint: fingerprint,
        };
      }
    }
    throw err;
  }

  const supersededIds = await supersedeInFlightRuns({
    projectId: input.projectId,
    newFingerprint: fingerprint,
    newRunId: run.id,
  });

  // 若抢占了 in-flight，优先把 supersedesRunId 指到被抢占的那个
  if (supersededIds.length > 0) {
    await db.tenderAnalysisRun.update({
      where: { id: run.id },
      data: { supersedesRunId: supersededIds[0] },
    });
  }

  // 显式未使用 inFlight 仅作探测；保留 lint 友好
  void inFlight;

  return {
    enqueued: true,
    runId: run.id,
    status: run.status,
    reason: gate.reason,
    documentCount: docs.length,
    packageFingerprint: fingerprint,
    classificationWarning: warning,
    supersededRunIds: supersededIds,
  };
}

export type ReanalyzePackageInput = {
  projectId: string;
  orgId: string;
  actorUserId: string;
};

export type ReanalyzePackageResult =
  | {
      ok: true;
      newRunId: string;
      documentCount: number;
      packageFingerprint: string;
      status: "PENDING";
    }
  | { ok: false; error: string; code: string };

/**
 * 对当前 tender package 重新分析（不要求重传 PDF）。
 */
export async function reanalyzeTenderPackage(
  input: ReanalyzePackageInput,
): Promise<ReanalyzePackageResult> {
  const otherActive = await db.tenderAnalysisRun.findFirst({
    where: {
      projectId: input.projectId,
      orgId: input.orgId,
      status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
    },
    select: { id: true },
  });
  if (otherActive) {
    return {
      ok: false,
      error: "当前分析仍在进行中，请等待完成后再重新分析",
      code: "active_run",
    };
  }

  const recentCount = await db.tenderAnalysisRun.count({
    where: {
      projectId: input.projectId,
      orgId: input.orgId,
      createdAt: { gte: new Date(Date.now() - REANALYZE_RATE_WINDOW_MS) },
    },
  });
  if (recentCount >= REANALYZE_RATE_MAX) {
    return {
      ok: false,
      error: "重新分析过于频繁，请稍后再试",
      code: "rate_limited",
    };
  }

  const docs = await getTenderPackageDocuments(input.projectId);
  if (docs.length === 0) {
    return {
      ok: false,
      error: "未找到可分析的投标 PDF（需 parse 完成且有内容指纹）",
      code: "no_package_documents",
    };
  }
  if (packageTooLarge(docs)) {
    return {
      ok: false,
      error: `投标文件包总页数超过上限（>${MAX_TENDER_PACKAGE_PAGES}），请人工选择文件后再分析`,
      code: "PACKAGE_TOO_LARGE",
    };
  }

  // 将当前非 APPROVED 的最新 REVIEW_REQUIRED 标 SUPERSEDED（保留 APPROVED）
  const review = await db.tenderAnalysisRun.findFirst({
    where: {
      projectId: input.projectId,
      orgId: input.orgId,
      status: "REVIEW_REQUIRED",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (review) {
    await db.tenderAnalysisRun.updateMany({
      where: { id: review.id, status: "REVIEW_REQUIRED" },
      data: {
        status: "SUPERSEDED",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
  }

  const result = await enqueueTenderPackageAnalysis({
    projectId: input.projectId,
    userId: input.actorUserId,
    orgId: input.orgId,
    forceNewRun: true,
  });

  if (!result.enqueued || !result.runId) {
    return {
      ok: false,
      error: result.reason === "PACKAGE_TOO_LARGE"
        ? `投标文件包总页数超过上限（>${MAX_TENDER_PACKAGE_PAGES}）`
        : result.reason ?? "入队失败",
      code: result.reason ?? "enqueue_failed",
    };
  }

  return {
    ok: true,
    newRunId: result.runId,
    documentCount: result.documentCount ?? docs.length,
    packageFingerprint: result.packageFingerprint ?? computePackageFingerprint(docs),
    status: "PENDING",
  };
}
