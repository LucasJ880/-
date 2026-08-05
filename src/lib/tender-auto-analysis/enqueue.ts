/**
 * 上传后自动入队 TenderAnalysisRun（HTTP 路径禁止调用 LLM）
 */

import { db } from "@/lib/db";
import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  type TenderAnalysisStatus,
} from "./constants";
import { canAutoEnqueueAnalysis } from "./gate";
import { fingerprintOrderedHashes, sha256Content } from "./hash";
import { buildIdempotencyKey } from "./idempotency";
import {
  ACTIVE_RUN_STATUSES,
  detectDocumentRole,
  detectRunKind,
  isPdfFileType,
  shouldSupersedeActiveRun,
  suggestionWhenGateClosed,
  SUPERSEDABLE_RUN_STATUSES,
} from "./enqueue-helpers";

export type MaybeEnqueueInput = {
  projectId: string;
  documentId: string;
  buffer: Buffer;
  fileType: string;
  title: string;
  userId: string;
  orgId: string;
};

export type MaybeEnqueueResult = {
  enqueued: boolean;
  runId?: string;
  status?: TenderAnalysisStatus | string;
  reason?: string;
  suggestion?: "mark_as_tender";
};

async function findActiveRunByKeyOrFingerprint(input: {
  projectId: string;
  idempotencyKey: string;
  fingerprint: string;
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

async function resolveParentRunId(projectId: string): Promise<string | null> {
  const approved = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
    select: { id: true },
  });
  if (approved) return approved.id;

  const review = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: "REVIEW_REQUIRED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return review?.id ?? null;
}

/**
 * 将同项目、可抢占状态、且指纹不同的旧跑标为 SUPERSEDED。
 * 不碰 APPROVED / REVIEW_REQUIRED。
 */
async function supersedeConflictingRuns(input: {
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

  const toSupersede = candidates.filter((c) =>
    shouldSupersedeActiveRun({
      existingFingerprint: c.sourceHashFingerprint,
      newFingerprint: input.newFingerprint,
      existingStatus: c.status,
    }),
  );

  const ids: string[] = [];
  for (const old of toSupersede) {
    const updated = await db.tenderAnalysisRun.updateMany({
      where: {
        id: old.id,
        status: { in: [...SUPERSEDABLE_RUN_STATUSES] },
      },
      data: { status: "SUPERSEDED" },
    });
    if (updated.count > 0) ids.push(old.id);
  }
  return ids;
}

/**
 * 上传成功后尝试入队自动分析。
 * - 仅写 contentHash / 创建 Run；不调用 LLM
 * - 门闸关闭时绝不改 workDomain
 */
export async function maybeEnqueueTenderAnalysisAfterUpload(
  input: MaybeEnqueueInput,
): Promise<MaybeEnqueueResult> {
  const contentHash = sha256Content(input.buffer);

  await db.projectDocument.update({
    where: { id: input.documentId },
    data: { contentHash },
  });

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
    const hint = suggestionWhenGateClosed({
      title: input.title,
      fileType: input.fileType,
    });
    return {
      enqueued: false,
      reason: gate.reason,
      ...hint,
    };
  }

  if (!isPdfFileType(input.fileType)) {
    return { enqueued: false, reason: "unsupported_file_type" };
  }

  const fingerprint = fingerprintOrderedHashes([contentHash]);
  const idempotencyKey = buildIdempotencyKey({
    projectId: input.projectId,
    fingerprint,
    promptVersion: PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
  });

  const existing = await findActiveRunByKeyOrFingerprint({
    projectId: input.projectId,
    idempotencyKey,
    fingerprint,
  });
  if (existing) {
    return {
      enqueued: false,
      runId: existing.id,
      status: existing.status,
      reason: "idempotent_reuse",
    };
  }

  const role = detectDocumentRole(input.title);
  const runKind = detectRunKind(role);
  const parentRunId =
    runKind === "INCREMENTAL"
      ? await resolveParentRunId(input.projectId)
      : null;

  let run;
  try {
    run = await db.tenderAnalysisRun.create({
      data: {
        orgId,
        projectId: input.projectId,
        roomId: project.intelligenceRoom?.id ?? null,
        status: "PENDING",
        runKind,
        analysisVersion: ANALYSIS_VERSION,
        promptVersion: PROMPT_VERSION,
        idempotencyKey,
        sourceHashFingerprint: fingerprint,
        createdById: input.userId,
        parentRunId,
        nextAttemptAt: new Date(),
        documents: {
          create: {
            documentId: input.documentId,
            contentHash,
            role: role === "ADDENDUM" ? "ADDENDUM" : "PRIMARY",
          },
        },
      },
      select: { id: true, status: true },
    });
  } catch (err) {
    // 并发下唯一键冲突 → 复用已有活跃跑
    const raced = await findActiveRunByKeyOrFingerprint({
      projectId: input.projectId,
      idempotencyKey,
      fingerprint,
    });
    if (raced) {
      return {
        enqueued: false,
        runId: raced.id,
        status: raced.status,
        reason: "idempotent_reuse",
      };
    }
    throw err;
  }

  const supersededIds = await supersedeConflictingRuns({
    projectId: input.projectId,
    newFingerprint: fingerprint,
    newRunId: run.id,
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
  };
}
