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
  MissingPackageContentHashError,
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

/**
 * 仅 SUPERSEDE 比 newRun 更早的飞行中跑，避免并发互相 SUPERSEDE 成零活跃。
 * forceSameFingerprint：reanalyze 同指纹也可抢占。
 */
async function supersedeInFlightRuns(input: {
  projectId: string;
  newFingerprint: string;
  newRunId: string;
  newRunCreatedAt: Date;
  forceSameFingerprint?: boolean;
}): Promise<string[]> {
  const candidates = await db.tenderAnalysisRun.findMany({
    where: {
      projectId: input.projectId,
      status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
      id: { not: input.newRunId },
      createdAt: { lt: input.newRunCreatedAt },
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
        forceSameFingerprint: input.forceSameFingerprint,
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

  let docs: PackageDocument[];
  try {
    // 缺 hash 一律硬失败：禁止静默缩小 package（含 package API enqueue）
    docs = await getTenderPackageDocuments(input.projectId, {
      forceIncludeDocumentIds: input.forceIncludeDocumentIds,
      failOnMissingHash: true,
    });
  } catch (e) {
    if (e instanceof MissingPackageContentHashError) {
      return {
        enqueued: false,
        reason: e.code,
        documentCount: 0,
      };
    }
    throw e;
  }
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

  const lineageId = await resolveLineageRunId(input.projectId);
  const warning = detectMultiplePrimaryWarning(docs);

  let run: { id: string; status: string; createdAt: Date };
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
      select: { id: true, status: true, createdAt: true },
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
    newRunCreatedAt: run.createdAt,
    forceSameFingerprint: Boolean(input.forceNewRun),
  });

  if (supersededIds.length > 0) {
    await db.tenderAnalysisRun.update({
      where: { id: run.id },
      data: { supersedesRunId: supersededIds[0] },
    });
  }

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
 * 事务内锁飞行中 Run，避免并发留下多个 active FULL；
 * 仅在新 Run 创建成功后才 SUPERSEDE REVIEW_REQUIRED。
 */
export async function reanalyzeTenderPackage(
  input: ReanalyzePackageInput,
): Promise<ReanalyzePackageResult> {
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

  let docs: PackageDocument[];
  try {
    docs = await getTenderPackageDocuments(input.projectId, {
      failOnMissingHash: true,
    });
  } catch (e) {
    if (e instanceof MissingPackageContentHashError) {
      return {
        ok: false,
        error: e.message,
        code: e.code,
      };
    }
    throw e;
  }
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

  const fingerprint = computePackageFingerprint(docs);
  const warning = detectMultiplePrimaryWarning(docs);

  try {
    const created = await db.$transaction(async (tx) => {
      // 行锁：串行化同项目飞行中 Run 检查，堵住并发 reanalyze
      await tx.$executeRaw`
        SELECT id FROM "TenderAnalysisRun"
        WHERE "projectId" = ${input.projectId}
          AND status IN ('PENDING', 'EXTRACTING', 'ANALYZING')
        FOR UPDATE
      `;

      const otherActive = await tx.tenderAnalysisRun.findFirst({
        where: {
          projectId: input.projectId,
          orgId: input.orgId,
          status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
        },
        select: { id: true },
      });
      if (otherActive) {
        return { blocked: "active_run" as const };
      }

      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        select: {
          orgId: true,
          workDomain: true,
          intelligenceRoom: { select: { id: true } },
        },
      });
      if (!project?.orgId) {
        return { blocked: "missing_org" as const };
      }
      const gate = canAutoEnqueueAnalysis({
        workDomain: project.workDomain,
        hasIntelligenceRoom: Boolean(project.intelligenceRoom),
      });
      if (!gate.ok) {
        return { blocked: gate.reason as string };
      }

      const lineage = await tx.tenderAnalysisRun.findFirst({
        where: {
          projectId: input.projectId,
          status: { in: ["REVIEW_REQUIRED", "APPROVED", "FAILED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const run = await tx.tenderAnalysisRun.create({
        data: {
          orgId: project.orgId,
          projectId: input.projectId,
          roomId: project.intelligenceRoom?.id ?? null,
          status: "PENDING",
          runKind: "FULL",
          analysisVersion: ANALYSIS_VERSION,
          promptVersion: PROMPT_VERSION,
          idempotencyKey: buildIdempotencyKey({
            projectId: input.projectId,
            fingerprint: `${fingerprint}:reanalyze:${Date.now()}`,
            promptVersion: PROMPT_VERSION,
            analysisVersion: ANALYSIS_VERSION,
          }),
          sourceHashFingerprint: fingerprint,
          createdById: input.actorUserId,
          parentRunId: null,
          supersedesRunId: lineage?.id ?? null,
          nextAttemptAt: new Date(),
          summaryJson: warning
            ? { classificationWarning: warning, documentCount: docs.length }
            : { documentCount: docs.length },
          documents: {
            create: docs.map((d) => ({
              documentId: d.documentId,
              contentHash: d.contentHash,
              role: d.role,
            })),
          },
        },
        select: { id: true },
      });

      // 仅在新 Run 创建成功后标记 REVIEW_REQUIRED（保留 APPROVED）
      await tx.tenderAnalysisRun.updateMany({
        where: {
          projectId: input.projectId,
          orgId: input.orgId,
          status: "REVIEW_REQUIRED",
          id: { not: run.id },
        },
        data: {
          status: "SUPERSEDED",
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      });

      return { blocked: null, runId: run.id };
    });

    if (created.blocked === "active_run") {
      return {
        ok: false,
        error: "当前分析仍在进行中，请等待完成后再重新分析",
        code: "active_run",
      };
    }
    if (created.blocked) {
      return {
        ok: false,
        error: created.blocked,
        code: created.blocked,
      };
    }

    return {
      ok: true,
      newRunId: created.runId!,
      documentCount: docs.length,
      packageFingerprint: fingerprint,
      status: "PENDING",
    };
  } catch (e) {
    // 唯一键冲突等：视为并发 reanalyze，提示稍后
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|idempotency/i.test(msg)) {
      return {
        ok: false,
        error: "当前分析仍在进行中，请等待完成后再重新分析",
        code: "active_run",
      };
    }
    throw e;
  }
}
