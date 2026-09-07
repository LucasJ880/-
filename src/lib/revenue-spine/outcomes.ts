/**
 * Revenue Spine — Business Outcome 集成（PART 10）
 *
 * 复用 employee-ai/outcome-service（sourceType 必须可验证；禁止 ai_inferred）。
 * entityType 固定 sales_opportunity；Action → Outcome 通过 salesActionId 关联。
 */

import { db } from "@/lib/db";
import { createBusinessOutcome } from "@/lib/employee-ai/outcome-service";
import type { OutcomeSourceType } from "@/lib/employee-ai/types";

export const REVENUE_OUTCOME_TYPES = [
  "CUSTOMER_REPLIED",
  "RFQ_RECEIVED",
  "QUOTE_CREATED",
  "QUOTE_SENT",
  "SAMPLE_REQUESTED",
  "SAMPLE_SENT",
  "NEGOTIATION_STARTED",
  "DEAL_WON",
  "DEAL_LOST",
  "REVENUE_RECORDED",
  "GROSS_PROFIT_RECORDED",
] as const;

export type RevenueOutcomeType = (typeof REVENUE_OUTCOME_TYPES)[number];

export const OUTCOME_ENTITY_TYPE = "sales_opportunity";

export function isRevenueOutcomeType(v: unknown): v is RevenueOutcomeType {
  return typeof v === "string" && (REVENUE_OUTCOME_TYPES as readonly string[]).includes(v);
}

export interface RecordOutcomeInput {
  orgId: string;
  opportunityId: string;
  outcomeType: RevenueOutcomeType;
  /** 触发该结果的动作类型（如 reply_sent / stage_transition / inbound_message） */
  actionType: string;
  sourceType: OutcomeSourceType;
  /** 幂等键：同 opportunity + outcomeType + sourceId 只记一次 */
  sourceId: string;
  salesActionId?: string | null;
  pendingActionId?: string | null;
  userId?: string | null;
  revenueImpact?: number | null;
  value?: Record<string, unknown>;
  confidence?: number;
  manuallyVerified?: boolean;
  actionOccurredAt?: Date;
}

export async function recordRevenueOutcome(input: RecordOutcomeInput): Promise<{ id: string; created: boolean }> {
  const existing = await db.businessOutcome.findFirst({
    where: {
      orgId: input.orgId,
      entityType: OUTCOME_ENTITY_TYPE,
      entityId: input.opportunityId,
      outcomeType: input.outcomeType,
      sourceId: input.sourceId,
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const row = await createBusinessOutcome({
    orgId: input.orgId,
    userId: input.userId ?? null,
    pendingActionId: input.pendingActionId ?? null,
    entityType: OUTCOME_ENTITY_TYPE,
    entityId: input.opportunityId,
    actionType: input.actionType,
    actionOccurredAt: input.actionOccurredAt,
    outcomeType: input.outcomeType,
    outcomeValue: input.value,
    revenueImpact: input.revenueImpact ?? null,
    confidence: input.confidence ?? (input.manuallyVerified ? 1 : 0.8),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    manuallyVerified: input.manuallyVerified === true,
    verifiedBy: input.manuallyVerified ? input.userId ?? null : null,
  });
  if (input.salesActionId) {
    await db.businessOutcome.update({ where: { id: row.id }, data: { salesActionId: input.salesActionId } });
  }
  return { id: row.id, created: true };
}

export async function listOpportunityOutcomes(orgId: string, opportunityId: string) {
  return db.businessOutcome.findMany({
    where: { orgId, entityType: OUTCOME_ENTITY_TYPE, entityId: opportunityId },
    orderBy: { actionOccurredAt: "asc" },
    select: {
      id: true,
      outcomeType: true,
      actionType: true,
      actionOccurredAt: true,
      revenueImpact: true,
      sourceType: true,
      sourceId: true,
      salesActionId: true,
      pendingActionId: true,
      manuallyVerified: true,
      outcomeValue: true,
    },
  });
}
