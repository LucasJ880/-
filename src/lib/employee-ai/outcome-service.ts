import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { EmployeeAiAccessError } from "./access";
import { OUTCOME_SOURCE_TYPES, type OutcomeSourceType } from "./types";

export interface CreateOutcomeInput {
  orgId: string;
  userId?: string | null;
  feedbackEventId?: string | null;
  pendingActionId?: string | null;
  skillExecutionId?: string | null;
  entityType: string;
  entityId: string;
  actionType: string;
  actionOccurredAt?: Date;
  outcomeType: string;
  outcomeValue?: unknown;
  successSignals?: unknown;
  failureSignals?: unknown;
  revenueImpact?: number | null;
  confidence?: number;
  sourceType: OutcomeSourceType;
  sourceId?: string | null;
  manuallyVerified?: boolean;
  verifiedBy?: string | null;
}

export async function createBusinessOutcome(input: CreateOutcomeInput) {
  if (!(OUTCOME_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) {
    throw new EmployeeAiAccessError("无效的 sourceType", 400);
  }
  // 禁止仅凭 AI 推测：sourceType 必须是可验证来源
  if (input.sourceType === ("ai_inferred" as OutcomeSourceType)) {
    throw new EmployeeAiAccessError("禁止仅凭 AI 推测写入 Outcome", 400);
  }

  if (input.feedbackEventId) {
    const fb = await db.humanFeedbackEvent.findFirst({
      where: { id: input.feedbackEventId, orgId: input.orgId },
      select: { id: true },
    });
    if (!fb) throw new EmployeeAiAccessError("反馈事件不存在或不属于当前组织", 404);
  }

  const row = await db.businessOutcome.create({
    data: {
      orgId: input.orgId,
      userId: input.userId ?? null,
      feedbackEventId: input.feedbackEventId ?? null,
      pendingActionId: input.pendingActionId ?? null,
      skillExecutionId: input.skillExecutionId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      actionType: input.actionType,
      actionOccurredAt: input.actionOccurredAt ?? new Date(),
      outcomeType: input.outcomeType,
      outcomeValue: input.outcomeValue as object | undefined,
      successSignals: input.successSignals as object | undefined,
      failureSignals: input.failureSignals as object | undefined,
      revenueImpact: input.revenueImpact ?? null,
      confidence: input.confidence ?? 0.5,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      manuallyVerified: input.manuallyVerified === true,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.manuallyVerified ? new Date() : null,
    },
  });

  await logAudit({
    userId: input.userId ?? "system",
    orgId: input.orgId,
    action: "employee_ai.outcome.create",
    targetType: "BusinessOutcome",
    targetId: row.id,
    afterData: {
      outcomeType: row.outcomeType,
      sourceType: row.sourceType,
      entityType: row.entityType,
    },
  });

  return row;
}

export async function updateBusinessOutcome(input: {
  orgId: string;
  userId: string;
  id: string;
  patch: {
    outcomeType?: string;
    outcomeValue?: unknown;
    successSignals?: unknown;
    failureSignals?: unknown;
    revenueImpact?: number | null;
    manuallyVerified?: boolean;
  };
}) {
  const existing = await db.businessOutcome.findFirst({
    where: { id: input.id, orgId: input.orgId },
  });
  if (!existing) throw new EmployeeAiAccessError("Outcome 不存在", 404);

  const data: Record<string, unknown> = {};
  if (input.patch.outcomeType !== undefined) data.outcomeType = input.patch.outcomeType;
  if (input.patch.outcomeValue !== undefined) {
    data.outcomeValue = input.patch.outcomeValue as object;
  }
  if (input.patch.successSignals !== undefined) {
    data.successSignals = input.patch.successSignals as object;
  }
  if (input.patch.failureSignals !== undefined) {
    data.failureSignals = input.patch.failureSignals as object;
  }
  if (input.patch.revenueImpact !== undefined) data.revenueImpact = input.patch.revenueImpact;
  if (input.patch.manuallyVerified === true) {
    data.manuallyVerified = true;
    data.verifiedBy = input.userId;
    data.verifiedAt = new Date();
  }

  return db.businessOutcome.update({ where: { id: existing.id }, data });
}

/** 强证据：需可验证来源，且置信度或人工确认达标 */
export function isStrongOutcomeEvidence(row: {
  sourceType: string;
  manuallyVerified: boolean;
  confidence: number;
}): boolean {
  if (row.sourceType === "ai_inferred") return false;
  if (row.manuallyVerified) return true;
  if (row.sourceType === "approval_result" || row.sourceType === "business_record") {
    return row.confidence >= 0.6;
  }
  if (row.sourceType === "user_confirmed" || row.sourceType === "connected_source") {
    return row.confidence >= 0.5;
  }
  return false;
}
