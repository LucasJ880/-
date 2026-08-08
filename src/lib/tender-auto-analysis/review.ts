/**
 * 人工审核工作流 — 纯函数 + 服务层
 * 批准绝不写入 GO 决策。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { REANALYZE_RATE_MAX, REANALYZE_RATE_WINDOW_MS } from "./constants";
import { canApproveRun } from "./review-pure";

export { canApproveRun, assertCanApprove } from "./review-pure";
export { REANALYZE_RATE_MAX, REANALYZE_RATE_WINDOW_MS };

export type ApproveRunInput = {
  runId: string;
  projectId: string;
  orgId: string;
  actorUserId: string;
  /** 为 true 时将全部 AI_EXTRACTED 要求标为 CONFIRMED；默认 false */
  confirmAllRequirements?: boolean;
};

export type ApproveRunResult =
  | {
      ok: true;
      runId: string;
      status: "APPROVED";
      confirmedRequirementCount: number;
      leftAiExtractedCount: number;
      idempotent?: boolean;
    }
  | { ok: false; error: string; code: string };

/**
 * REVIEW_REQUIRED → APPROVED。
 * - CAS：仅当 status 仍为 REVIEW_REQUIRED 时批准
 * - 仅确认 manuallyConfirmed 的要求，或 confirmAllRequirements
 * - 未确认保持 AI_EXTRACTED
 * - NEVER 写入 BidIntelligenceRoom.goDecision / Project.bidPhaseStatus=GO
 */
export async function approveAnalysisRun(
  input: ApproveRunInput,
): Promise<ApproveRunResult> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true, status: true, approvedById: true, approvedAt: true },
  });
  if (!run) {
    return { ok: false, error: "分析记录不存在", code: "not_found" };
  }

  // 重复批准：幂等成功，不改写 approvedBy
  if (run.status === "APPROVED") {
    const confirmedRequirementCount = await db.tenderExtractedRequirement.count({
      where: { analysisRunId: run.id, reviewStatus: "CONFIRMED" },
    });
    const leftAiExtractedCount = await db.tenderExtractedRequirement.count({
      where: { analysisRunId: run.id, reviewStatus: "AI_EXTRACTED" },
    });
    return {
      ok: true,
      runId: run.id,
      status: "APPROVED",
      confirmedRequirementCount,
      leftAiExtractedCount,
      idempotent: true,
    };
  }

  if (!canApproveRun(run.status)) {
    return {
      ok: false,
      error: `当前状态「${run.status}」不可批准，仅「等待审核」可批准`,
      code: "invalid_status",
    };
  }

  const now = new Date();
  let confirmedRequirementCount = 0;
  let wonCas = false;

  try {
    await db.$transaction(async (tx) => {
      const cas = await tx.tenderAnalysisRun.updateMany({
        where: {
          id: run.id,
          projectId: input.projectId,
          orgId: input.orgId,
          status: "REVIEW_REQUIRED",
        },
        data: {
          status: "APPROVED",
          approvedById: input.actorUserId,
          approvedAt: now,
        },
      });
      if (cas.count === 0) {
        const cur = await tx.tenderAnalysisRun.findFirst({
          where: {
            id: run.id,
            projectId: input.projectId,
            orgId: input.orgId,
          },
          select: { status: true },
        });
        if (cur?.status === "APPROVED") {
          wonCas = false;
          return;
        }
        throw new Error("approve_cas_failed");
      }
      wonCas = true;

      if (input.confirmAllRequirements) {
        const updated = await tx.tenderExtractedRequirement.updateMany({
          where: {
            analysisRunId: run.id,
            reviewStatus: "AI_EXTRACTED",
          },
          data: { reviewStatus: "CONFIRMED" },
        });
        confirmedRequirementCount = updated.count;
      } else {
        confirmedRequirementCount = await tx.tenderExtractedRequirement.count({
          where: { analysisRunId: run.id, reviewStatus: "CONFIRMED" },
        });
      }

      await tx.tenderAnalysisSection.updateMany({
        where: {
          runId: run.id,
          reviewStatus: { in: ["AI_DRAFT", "HUMAN_EDITED"] },
        },
        data: { reviewStatus: "APPROVED" },
      });

      await writeAuditLog(tx, {
        userId: input.actorUserId,
        orgId: input.orgId,
        projectId: input.projectId,
        action: "tender_analysis_approve",
        targetType: "tender_analysis_run",
        targetId: run.id,
        beforeData: { status: "REVIEW_REQUIRED" },
        afterData: {
          status: "APPROVED",
          confirmAllRequirements: Boolean(input.confirmAllRequirements),
          confirmedRequirementCount,
          goDecisionUntouched: true,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "approve_cas_failed") {
      return {
        ok: false,
        error: "批准冲突，请刷新后重试",
        code: "conflict",
      };
    }
    throw err;
  }

  const leftAiExtractedCount = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: run.id, reviewStatus: "AI_EXTRACTED" },
  });

  if (!wonCas) {
    const confirmed = await db.tenderExtractedRequirement.count({
      where: { analysisRunId: run.id, reviewStatus: "CONFIRMED" },
    });
    return {
      ok: true,
      runId: run.id,
      status: "APPROVED",
      confirmedRequirementCount: confirmed,
      leftAiExtractedCount,
      idempotent: true,
    };
  }

  return {
    ok: true,
    runId: run.id,
    status: "APPROVED",
    confirmedRequirementCount,
    leftAiExtractedCount,
  };
}

export type ReanalyzeInput = {
  runId: string;
  projectId: string;
  orgId: string;
  actorUserId: string;
};

export type ReanalyzeResult =
  | {
      ok: true;
      newRunId: string;
      supersededRunId: string | null;
      status: "PENDING";
      documentCount?: number;
    }
  | { ok: false; error: string; code: string };

/**
 * Phase 1.1.1：按当前 tender package 重新分析（非单 document 克隆）。
 */
export async function reanalyzeRun(
  input: ReanalyzeInput,
): Promise<ReanalyzeResult> {
  const current = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false, error: "分析记录不存在", code: "not_found" };
  }
  if (current.status === "SUPERSEDED") {
    return {
      ok: false,
      error: "已被替代的分析不可再次重新分析，请从最新记录操作",
      code: "invalid_status",
    };
  }

  const { reanalyzeTenderPackage } = await import("./enqueue-package");
  const result = await reanalyzeTenderPackage({
    projectId: input.projectId,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code };
  }
  return {
    ok: true,
    newRunId: result.newRunId,
    supersededRunId:
      current.status === "APPROVED" ? null : current.id,
    status: "PENDING",
    documentCount: result.documentCount,
  };
}

export type EditSectionInput = {
  runId: string;
  sectionId: string;
  projectId: string;
  orgId: string;
  actorUserId: string;
  contentZh: string;
  note?: string;
};

export async function editSectionContent(input: EditSectionInput): Promise<
  | { ok: true; sectionId: string; reviewStatus: "HUMAN_EDITED" }
  | { ok: false; error: string; code: string }
> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true, status: true },
  });
  if (!run) return { ok: false, error: "分析记录不存在", code: "not_found" };
  if (run.status === "APPROVED" || run.status === "SUPERSEDED") {
    return { ok: false, error: "已批准或已替代的分析不可编辑", code: "locked" };
  }

  const section = await db.tenderAnalysisSection.findFirst({
    where: { id: input.sectionId, runId: run.id },
    select: { id: true, structuredJson: true, contentZh: true },
  });
  if (!section) {
    return { ok: false, error: "章节不存在", code: "not_found" };
  }

  const prev = asJsonObject(section.structuredJson);
  const edits = Array.isArray(prev._edits) ? [...(prev._edits as unknown[])] : [];
  edits.push({
    at: new Date().toISOString(),
    by: input.actorUserId,
    note: input.note?.trim().slice(0, 500) || null,
    beforeLen: section.contentZh.length,
    afterLen: input.contentZh.length,
  });

  const structuredJson = {
    ...prev,
    _edits: edits,
  } as unknown as Prisma.InputJsonValue;

  await db.tenderAnalysisSection.update({
    where: { id: section.id },
    data: {
      contentZh: input.contentZh,
      reviewStatus: "HUMAN_EDITED",
      structuredJson,
    },
  });

  return { ok: true, sectionId: section.id, reviewStatus: "HUMAN_EDITED" };
}

function asJsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...(v as Record<string, unknown>) };
  }
  return {};
}

export async function confirmFact(input: {
  runId: string;
  factId: string;
  projectId: string;
  orgId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const fact = await findFactInScope(input);
  if (!fact) return { ok: false, error: "事实不存在", code: "not_found" };
  await db.tenderAnalysisFact.update({
    where: { id: fact.id },
    data: {
      manuallyConfirmed: true,
      confirmedById: input.actorUserId,
      confirmedAt: new Date(),
    },
  });
  return { ok: true };
}

export async function rejectFact(input: {
  runId: string;
  factId: string;
  projectId: string;
  orgId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const fact = await findFactInScope(input);
  if (!fact) return { ok: false, error: "事实不存在", code: "not_found" };
  await db.tenderAnalysisFact.update({
    where: { id: fact.id },
    data: {
      manuallyConfirmed: false,
      confirmedById: input.actorUserId,
      confirmedAt: new Date(),
      // 用 statementKind 保持；拒绝记在 confidence
      confidence: "UNKNOWN",
    },
  });
  return { ok: true };
}

async function findFactInScope(input: {
  runId: string;
  factId: string;
  projectId: string;
  orgId: string;
}) {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  if (!run) return null;
  return db.tenderAnalysisFact.findFirst({
    where: { id: input.factId, runId: run.id },
    select: { id: true },
  });
}

export async function confirmRequirement(input: {
  runId: string;
  requirementId: string;
  projectId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const req = await findRequirementInScope(input);
  if (!req) return { ok: false, error: "要求不存在", code: "not_found" };
  await db.tenderExtractedRequirement.update({
    where: { id: req.id },
    data: { reviewStatus: "CONFIRMED" },
  });
  return { ok: true };
}

export async function rejectRequirement(input: {
  runId: string;
  requirementId: string;
  projectId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const req = await findRequirementInScope(input);
  if (!req) return { ok: false, error: "要求不存在", code: "not_found" };
  await db.tenderExtractedRequirement.update({
    where: { id: req.id },
    data: { reviewStatus: "REJECTED" },
  });
  return { ok: true };
}

async function findRequirementInScope(input: {
  runId: string;
  requirementId: string;
  projectId: string;
  orgId: string;
}) {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  if (!run) return null;
  return db.tenderExtractedRequirement.findFirst({
    where: {
      id: input.requirementId,
      analysisRunId: run.id,
      projectId: input.projectId,
    },
    select: { id: true },
  });
}

export async function batchConfirmRequirements(input: {
  runId: string;
  projectId: string;
  orgId: string;
  requirementIds: string[];
}): Promise<{ ok: true; confirmedCount: number } | { ok: false; error: string; code: string }> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  if (!run) return { ok: false, error: "分析记录不存在", code: "not_found" };

  const ids = input.requirementIds.filter(Boolean).slice(0, 200);
  if (ids.length === 0) {
    return { ok: false, error: "未提供要求 ID", code: "bad_request" };
  }

  const updated = await db.tenderExtractedRequirement.updateMany({
    where: {
      analysisRunId: run.id,
      projectId: input.projectId,
      id: { in: ids },
      reviewStatus: "AI_EXTRACTED",
    },
    data: { reviewStatus: "CONFIRMED" },
  });

  return { ok: true, confirmedCount: updated.count };
}
