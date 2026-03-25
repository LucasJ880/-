/**
 * 项目阶段推进 — 规则层与统一写入 service
 *
 * 所有项目进展变更必须通过此模块，不允许分散在各 route 中直接写时间戳。
 * Source of truth: Project 表上的时间戳字段，由 getProjectStage() 推导阶段。
 *
 * P0 策略：所有推进一律 require_human_review，必须用户确认后才写库。
 * 未来可放开低风险阶段为 allow（见 validateStageTransition 注释）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { TenderStage } from "./types";
import { getProjectStage } from "./stage";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { emitProjectPatchEvents, onStageAdvanced } from "@/lib/project-discussion/system-events";
import { notifyProjectStatusChange } from "@/lib/webhook/dispatcher";

// ── 常量 ────────────────────────────────────────────────────

export const STAGE_ORDER: TenderStage[] = [
  "initiation",
  "distribution",
  "interpretation",
  "supplier_inquiry",
  "supplier_quote",
  "submission",
];

export const STAGE_LABEL: Record<TenderStage, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

/**
 * 推进到某阶段时需要写入的 Project 时间戳字段。
 * initiation 不在此映射中 — 它是默认起始态，无需写入。
 */
export const STAGE_TO_TIMESTAMP: Partial<Record<TenderStage, string>> = {
  distribution: "distributedAt",
  interpretation: "interpretedAt",
  supplier_inquiry: "supplierInquiredAt",
  supplier_quote: "supplierQuotedAt",
  submission: "submittedAt",
};

/**
 * 推进到某阶段时同步写入的 tenderStatus 值。
 * 原因：intelligence-card badge、BidToGo webhook、AI context 都读 tenderStatus。
 */
export const STAGE_TO_TENDER_STATUS: Partial<Record<TenderStage, string>> = {
  distribution: "under_review",
  interpretation: "pursuing",
  supplier_inquiry: "supplier_inquiry",
  supplier_quote: "supplier_quote",
  submission: "bid_submitted",
};

// ── 校验结果类型 ────────────────────────────────────────────

export type TransitionDecision = "allow" | "deny" | "require_human_review" | "no_op";

export interface TransitionValidation {
  decision: TransitionDecision;
  targetStage: TenderStage | null;
  reason: string;
}

// ── 校验函数 ────────────────────────────────────────────────

/**
 * 校验阶段流转合法性。
 *
 * P0 策略：所有合法推进均返回 require_human_review。
 * 未来放开时，可将单步低风险推进改为 allow。
 */
export function validateStageTransition(
  currentStage: TenderStage,
  targetStage: TenderStage,
  _confidence: number = 1
): TransitionValidation {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  const targetIdx = STAGE_ORDER.indexOf(targetStage);

  if (targetIdx < 0 || currentIdx < 0) {
    return { decision: "deny", targetStage: null, reason: "无效的阶段值" };
  }

  // 同阶段 → 幂等 no-op（不是错误，前端按成功处理）
  if (targetIdx === currentIdx) {
    return {
      decision: "no_op",
      targetStage,
      reason: `当前已在「${STAGE_LABEL[currentStage]}」阶段，无需重复推进`,
    };
  }

  // 回退 → 明确拒绝
  if (targetIdx < currentIdx) {
    return {
      decision: "deny",
      targetStage: null,
      reason: `不允许回退：当前已在「${STAGE_LABEL[currentStage]}」，不能回退到「${STAGE_LABEL[targetStage]}」`,
    };
  }

  // P0: 所有合法推进一律需要人工确认
  const stepCount = targetIdx - currentIdx;
  let reason: string;
  if (stepCount > 1) {
    reason = `跳级推进（跨 ${stepCount} 步：${STAGE_LABEL[currentStage]} → ${STAGE_LABEL[targetStage]}），需要人工确认`;
  } else {
    reason = `推进到「${STAGE_LABEL[targetStage]}」，需要人工确认`;
  }

  return { decision: "require_human_review", targetStage, reason };

  // ── 未来放开自动推进时的逻辑（P0 不启用） ──
  // const HIGH_RISK: Set<TenderStage> = new Set(["supplier_quote", "submission"]);
  // if (confidence < 0.7) return { decision: "require_human_review", ... };
  // if (stepCount > 1) return { decision: "require_human_review", ... };
  // if (HIGH_RISK.has(targetStage)) return { decision: "require_human_review", ... };
  // return { decision: "allow", ... };
}

// ── 统一写入 service ────────────────────────────────────────

export interface AdvanceStageInput {
  projectId: string;
  targetStage: TenderStage;
  reason: string;
  source: "ai_suggestion" | "manual";
  actor: { id: string; name: string; email: string };
  humanConfirmed: boolean;
  confidence?: number;
  evidence?: string[];
}

export interface AdvanceStageResult {
  success: boolean;
  decision: TransitionDecision;
  reason: string;
  project?: Record<string, unknown>;
}

const PROJECT_INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  _count: { select: { tasks: true, environments: true } },
} as const;

export async function advanceProjectStage(
  input: AdvanceStageInput
): Promise<AdvanceStageResult> {
  const {
    projectId,
    targetStage,
    reason,
    source,
    actor,
    humanConfirmed,
    confidence,
    evidence,
  } = input;

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return { success: false, decision: "deny", reason: "项目不存在" };
  }

  const tenderProject = {
    submittedAt: project.submittedAt?.toISOString() ?? null,
    supplierQuotedAt: project.supplierQuotedAt?.toISOString() ?? null,
    supplierInquiredAt: project.supplierInquiredAt?.toISOString() ?? null,
    interpretedAt: project.interpretedAt?.toISOString() ?? null,
    distributedAt: project.distributedAt?.toISOString() ?? null,
    dispatchedAt: project.dispatchedAt?.toISOString() ?? null,
    intakeStatus: project.intakeStatus ?? null,
    tenderStatus: project.tenderStatus ?? null,
    createdAt: project.createdAt?.toISOString() ?? null,
    publicDate: project.publicDate?.toISOString() ?? null,
    questionCloseDate: project.questionCloseDate?.toISOString() ?? null,
    closeDate: project.closeDate?.toISOString() ?? null,
    dueDate: project.dueDate?.toISOString() ?? null,
    awardDate: project.awardDate?.toISOString() ?? null,
  };

  const currentStage = getProjectStage(tenderProject);
  const validation = validateStageTransition(currentStage, targetStage, confidence);

  // no_op：已在目标阶段，直接返回成功，不写库
  if (validation.decision === "no_op") {
    return { success: true, decision: "no_op", reason: validation.reason };
  }

  if (validation.decision === "deny") {
    return { success: false, decision: "deny", reason: validation.reason };
  }

  // P0: require_human_review 时后端强制要求 humanConfirmed === true
  if (validation.decision === "require_human_review" && !humanConfirmed) {
    return {
      success: false,
      decision: "require_human_review",
      reason: validation.reason,
    };
  }

  // 并发保护：时间戳字段已有值则 no-op，防止重复点击
  const timestampField = STAGE_TO_TIMESTAMP[targetStage];
  if (
    timestampField &&
    project[timestampField as keyof typeof project] != null
  ) {
    return {
      success: true,
      decision: "no_op",
      reason: `「${STAGE_LABEL[targetStage]}」阶段已完成，无需重复写入`,
    };
  }

  const newTenderStatus = STAGE_TO_TENDER_STATUS[targetStage];
  const now = new Date();

  const data: Record<string, unknown> = {};
  if (timestampField) {
    data[timestampField] = now;
  }
  if (newTenderStatus) {
    data.tenderStatus = newTenderStatus;
  }

  const updated = await db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const result = await tx.project.update({
        where: { id: projectId },
        data,
        include: PROJECT_INCLUDE,
      });

      const afterSnap = { ...project, ...data };
      await emitProjectPatchEvents(
        projectId,
        project as unknown as Record<string, unknown>,
        afterSnap as unknown as Record<string, unknown>,
        { id: actor.id, name: actor.name },
        tx
      );

      await onStageAdvanced(
        projectId,
        currentStage,
        targetStage,
        actor.id,
        actor.name,
        source,
        confidence,
        tx
      );

      return result;
    },
    { timeout: 15000 }
  );

  await logAudit({
    userId: actor.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: projectId,
    beforeData: {
      stage: currentStage,
      tenderStatus: project.tenderStatus,
    },
    afterData: {
      stage: targetStage,
      tenderStatus: newTenderStatus ?? project.tenderStatus,
      reason,
      source,
      humanConfirmed,
      confidence: confidence ?? null,
      evidence: evidence ?? [],
    },
  });

  if (newTenderStatus && project.sourceSystem) {
    notifyProjectStatusChange({
      projectId,
      oldStatus: project.tenderStatus || "new",
      newStatus: newTenderStatus,
      updatedBy: actor.email,
    }).catch((err) => console.error("[Webhook] dispatch failed:", err));
  }

  return {
    success: true,
    decision: "require_human_review",
    reason: `已推进到「${STAGE_LABEL[targetStage]}」`,
    project: updated as unknown as Record<string, unknown>,
  };
}
