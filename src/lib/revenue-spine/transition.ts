/**
 * Revenue Spine — 唯一合法的阶段写入口（PART 1 / 10）
 *
 * - 校验 ALLOWED_TRANSITIONS（无效流转 → INVALID_STAGE_TRANSITION）
 * - 写 stageChangedAt / wonAt / lostAt / lostReason
 * - 阶段隐含的 Business Outcome 在此落库（sourceType 按来源：human=user_confirmed / fde·system=business_record）
 * - 重算 Next Action
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { applyNextAction, type NextAction } from "./next-action";
import { canTransition, toCanonicalStage, type OpportunityStage } from "./opportunity-stage";
import { recordRevenueOutcome, type RevenueOutcomeType } from "./outcomes";
import type { RevenueSpinePolicy } from "./policy";

export type TransitionSource = "human" | "fde" | "system";

export interface TransitionInput {
  orgId: string;
  opportunityId: string;
  to: OpportunityStage;
  actorUserId: string | null;
  source: TransitionSource;
  reason?: string | null;
  estimatedValue?: number | null;
  salesActionId?: string | null;
  agentRunId?: string | null;
  policy?: RevenueSpinePolicy;
  now?: Date;
}

export type TransitionResult =
  | { ok: true; from: string; to: OpportunityStage; outcomes: RevenueOutcomeType[]; nextAction: NextAction | null }
  | { ok: false; code: "NOT_FOUND" | "INVALID_STAGE_TRANSITION" | "LEGACY_STAGE"; error: string; from?: string };

/** 阶段 → 隐含结果（进入该阶段即表示该事实已发生） */
const STAGE_OUTCOMES: Partial<Record<OpportunityStage, RevenueOutcomeType[]>> = {
  rfq_ready: ["RFQ_RECEIVED"],
  quoted: ["QUOTE_SENT"],
  sample: ["SAMPLE_REQUESTED"],
  negotiation: ["NEGOTIATION_STARTED"],
  won: ["DEAL_WON"],
  lost: ["DEAL_LOST"],
};

export async function transitionOpportunity(input: TransitionInput): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const opp = await db.salesOpportunity.findFirst({
    where: { id: input.opportunityId, orgId: input.orgId },
    select: { id: true, stage: true, estimatedValue: true, title: true, assignedToId: true, createdById: true },
  });
  if (!opp) return { ok: false, code: "NOT_FOUND", error: "商机不存在或跨组织" };
  // 审计 / 结果行的 userId 有外键：FDE/system 流转记到商机负责人名下，source 字段区分人机
  const auditUserId = input.actorUserId ?? opp.assignedToId ?? opp.createdById;
  const from = toCanonicalStage(opp.stage);
  if (!from) return { ok: false, code: "LEGACY_STAGE", error: `当前阶段「${opp.stage}」不在 canonical 词表`, from: opp.stage };
  // Sunny 历史阶段不由本引擎流转（报表投影可用，写入不可）
  if (from !== opp.stage) return { ok: false, code: "LEGACY_STAGE", error: `历史阶段「${opp.stage}」不由 Revenue Spine 流转`, from: opp.stage };
  if (!canTransition(from, input.to)) {
    return { ok: false, code: "INVALID_STAGE_TRANSITION", error: `不允许的阶段流转：${from} → ${input.to}`, from };
  }

  const estimatedValue =
    typeof input.estimatedValue === "number" && Number.isFinite(input.estimatedValue) ? input.estimatedValue : opp.estimatedValue;

  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: {
      stage: input.to,
      stageChangedAt: now,
      ...(estimatedValue !== opp.estimatedValue ? { estimatedValue } : {}),
      ...(input.to === "won" ? { wonAt: now } : {}),
      ...(input.to === "lost" ? { lostAt: now, lostReason: input.reason ?? null } : {}),
      ...(input.to === "disqualified" ? { lostReason: input.reason ?? null } : {}),
    },
  });

  const outcomes: RevenueOutcomeType[] = [];
  const sourceType = input.source === "human" ? "user_confirmed" : "business_record";
  for (const outcomeType of STAGE_OUTCOMES[input.to] ?? []) {
    await recordRevenueOutcome({
      orgId: input.orgId,
      opportunityId: opp.id,
      outcomeType,
      actionType: `stage_transition:${from}->${input.to}`,
      sourceType,
      sourceId: `transition:${opp.id}:${input.to}:${now.getTime()}`,
      salesActionId: input.salesActionId ?? null,
      userId: auditUserId,
      revenueImpact: input.to === "won" ? estimatedValue ?? null : null,
      value: { from, to: input.to, reason: input.reason ?? null, source: input.source, agentRunId: input.agentRunId ?? null },
      manuallyVerified: input.source === "human",
      actionOccurredAt: now,
    });
    outcomes.push(outcomeType);
  }
  if (input.to === "won" && estimatedValue && estimatedValue > 0) {
    await recordRevenueOutcome({
      orgId: input.orgId,
      opportunityId: opp.id,
      outcomeType: "REVENUE_RECORDED",
      actionType: "deal_won",
      sourceType,
      sourceId: `revenue:${opp.id}:${now.getTime()}`,
      salesActionId: input.salesActionId ?? null,
      userId: auditUserId,
      revenueImpact: estimatedValue,
      value: { amount: estimatedValue, basis: "estimatedValue", grossProfit: null, grossProfitNote: "cost basis unavailable (V2)" },
      manuallyVerified: input.source === "human",
      actionOccurredAt: now,
    });
    outcomes.push("REVENUE_RECORDED");
  }

  await logAudit({
    userId: auditUserId,
    orgId: input.orgId,
    action: "revenue_spine.opportunity.transition",
    targetType: "sales_opportunity",
    targetId: opp.id,
    beforeData: { stage: from },
    afterData: { stage: input.to, source: input.source, reason: input.reason ?? null, salesActionId: input.salesActionId ?? null },
  });

  const nextAction = await applyNextAction(input.orgId, opp.id, { policy: input.policy, now });
  return { ok: true, from, to: input.to, outcomes, nextAction };
}
