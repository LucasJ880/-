/**
 * Addendum 增量对比骨架 — 高层对比 parent vs new run 的要求/日期。
 * 仅产出 ChangeCandidate 描述；apply 不自动改写已批准要求。
 */

import { db } from "@/lib/db";
import {
  diffRequirements,
  type DiffRequirement,
  type DiffCandidate,
} from "./addendum-diff-pure";

export {
  diffRequirements,
  type DiffRequirement,
  type DiffCandidate,
} from "./addendum-diff-pure";

export type PersistAddendumDiffInput = {
  runId: string;
  parentRunId: string;
  projectId: string;
  orgId: string;
};

/**
 * 读取 parent/new run 要求并写入 PENDING_REVIEW 候选（幂等：同 run 已有则跳过）。
 */
export async function computeAndPersistAddendumDiff(
  input: PersistAddendumDiffInput,
): Promise<{ created: number; skipped: boolean }> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
      runKind: "INCREMENTAL",
    },
    select: { id: true, parentRunId: true },
  });
  if (!run) return { created: 0, skipped: true };

  const existing = await db.tenderAnalysisChangeCandidate.count({
    where: { runId: run.id },
  });
  if (existing > 0) return { created: 0, skipped: true };

  const parentId = input.parentRunId || run.parentRunId;
  if (!parentId) return { created: 0, skipped: true };

  const [beforeRows, afterRows] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: parentId },
      select: {
        requirementCode: true,
        chineseTranslation: true,
        originalRequirement: true,
        mandatory: true,
        sourcePage: true,
      },
    }),
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: run.id },
      select: {
        requirementCode: true,
        chineseTranslation: true,
        originalRequirement: true,
        mandatory: true,
        sourcePage: true,
      },
    }),
  ]);

  const candidates = diffRequirements(
    beforeRows as DiffRequirement[],
    afterRows as DiffRequirement[],
  );
  if (candidates.length === 0) return { created: 0, skipped: false };

  await db.tenderAnalysisChangeCandidate.createMany({
    data: candidates.map((c) => ({
      runId: run.id,
      parentRunId: parentId,
      changeType: c.changeType,
      entityType: c.entityType,
      entityKey: c.entityKey,
      beforeJson: c.beforeJson as object | undefined,
      afterJson: c.afterJson as object | undefined,
      summaryZh: c.summaryZh,
      status: "PENDING_REVIEW",
    })),
  });

  return { created: candidates.length, skipped: false };
}

/**
 * 应用候选：仅标记 APPLIED 并记录意图，不改写已批准要求。
 */
export async function applyChangeCandidate(input: {
  runId: string;
  candidateId: string;
  projectId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  if (!run) return { ok: false, error: "分析记录不存在", code: "not_found" };

  const candidate = await db.tenderAnalysisChangeCandidate.findFirst({
    where: { id: input.candidateId, runId: run.id },
    select: { id: true, status: true, afterJson: true, summaryZh: true },
  });
  if (!candidate) {
    return { ok: false, error: "变更候选不存在", code: "not_found" };
  }
  if (candidate.status !== "PENDING_REVIEW") {
    return { ok: false, error: "该候选已处理", code: "already_resolved" };
  }

  await db.tenderAnalysisChangeCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      afterJson: {
        ...asObj(candidate.afterJson),
        _applyIntent: {
          appliedAt: new Date().toISOString(),
          note: "仅记录接受意图，未自动改写已批准要求",
          summaryZh: candidate.summaryZh,
        },
      },
    },
  });

  return { ok: true };
}

export async function rejectChangeCandidate(input: {
  runId: string;
  candidateId: string;
  projectId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      id: input.runId,
      projectId: input.projectId,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  if (!run) return { ok: false, error: "分析记录不存在", code: "not_found" };

  const updated = await db.tenderAnalysisChangeCandidate.updateMany({
    where: {
      id: input.candidateId,
      runId: run.id,
      status: "PENDING_REVIEW",
    },
    data: { status: "REJECTED" },
  });
  if (updated.count === 0) {
    return { ok: false, error: "变更候选不存在或已处理", code: "not_found" };
  }
  return { ok: true };
}

function asObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
