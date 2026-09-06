/**
 * Revenue Spine — Next Action Engine（PART 7 / 16）
 *
 * 每个 open Opportunity 必须有 nextActionType / nextFollowupAt(=nextActionAt) / nextActionReason。
 * 全部时限来自 policy（SLA / follow-up），不写死。
 */

import { db } from "@/lib/db";
import { addBusinessDays, addBusinessHours } from "./business-days";
import { isOpenStage, toCanonicalStage } from "./opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";

export const NEXT_ACTION_TYPES = [
  "reply_inquiry",
  "reply_customer",
  "follow_up",
  "send_quote",
  "quote_follow_up",
  "sample_follow_up",
  "negotiation_follow_up",
  "nurture_check_in",
  "revive_or_close",
] as const;

export type NextActionType = (typeof NEXT_ACTION_TYPES)[number];

export interface NextAction {
  type: NextActionType;
  at: Date;
  reason: string;
}

export interface NextActionOpportunity {
  stage: string;
  createdAt: Date;
  stageChangedAt: Date | null;
  lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null;
  lastOutboundAt: Date | null;
  followUpCount: number;
}

export const NEXT_ACTION_LABELS: Record<NextActionType, { zh: string; en: string }> = {
  reply_inquiry: { zh: "回复新询盘", en: "Reply to new inquiry" },
  reply_customer: { zh: "回复客户来信", en: "Reply to customer" },
  follow_up: { zh: "跟进无回复客户", en: "Follow up (no reply)" },
  send_quote: { zh: "发出报价", en: "Send quotation" },
  quote_follow_up: { zh: "报价后跟进", en: "Quote follow-up" },
  sample_follow_up: { zh: "样品跟进", en: "Sample follow-up" },
  negotiation_follow_up: { zh: "谈判跟进", en: "Negotiation follow-up" },
  nurture_check_in: { zh: "培育回访", en: "Nurture check-in" },
  revive_or_close: { zh: "激活或关闭", en: "Revive or close" },
};

/** 纯函数：按阶段与时间戳计算下一步（terminal → null） */
export function computeNextAction(opp: NextActionOpportunity, policy: RevenueSpinePolicy, now: Date = new Date()): NextAction | null {
  const stage = toCanonicalStage(opp.stage);
  if (!stage) return null;
  const sla = policy.salesSla;
  const fu = policy.followUp;
  const stageAt = opp.stageChangedAt ?? opp.createdAt;
  // 客户在我方上一次外发之后来信 → 最高优先级；首封询盘（尚无外发）走新询盘 SLA
  const customerWaiting =
    !!opp.lastCustomerReplyAt && !!opp.lastOutboundAt && opp.lastCustomerReplyAt.getTime() > opp.lastOutboundAt.getTime();

  if (stage === "won" || stage === "lost" || stage === "disqualified") return null;

  if (stage === "nurture") {
    return {
      type: "nurture_check_in",
      at: new Date(stageAt.getTime() + fu.nurtureCheckInDays * 86_400_000),
      reason: `培育客户每 ${fu.nurtureCheckInDays} 天回访一次`,
    };
  }
  if (stage === "stale") {
    return { type: "revive_or_close", at: now, reason: "长期无动作商机需决定激活或关闭" };
  }

  // 客户来信后我们未回复：最高优先级
  if (customerWaiting) {
    return {
      type: "reply_customer",
      at: addBusinessHours(opp.lastCustomerReplyAt!, sla.customerReplyResponseHours),
      reason: `客户 ${opp.lastCustomerReplyAt!.toISOString().slice(0, 16)} 来信，SLA ${sla.customerReplyResponseHours} 工作小时内回复`,
    };
  }

  switch (stage) {
    case "new_inquiry":
    case "enriching":
    case "needs_info":
    case "qualified":
    case "rfq_ready": {
      if (!opp.lastOutboundAt) {
        return {
          type: "reply_inquiry",
          at: addBusinessHours(opp.lastCustomerReplyAt ?? opp.createdAt, sla.newInquiryResponseHours),
          reason: `新询盘 ${sla.newInquiryResponseHours} 工作小时内人工处理`,
        };
      }
      return {
        type: "follow_up",
        at: addBusinessDays(opp.lastOutboundAt, fu.afterReplyNoResponseBusinessDays),
        reason: `已回复客户，${fu.afterReplyNoResponseBusinessDays} 个工作日无回复则跟进`,
      };
    }
    case "quoting":
      return {
        type: "send_quote",
        at: addBusinessDays(stageAt, 2),
        reason: "RFQ 就绪后 2 个工作日内发出报价",
      };
    case "quoted":
    case "follow_up": {
      const days = fu.quoteFollowUpDays;
      const idx = Math.min(Math.max(0, opp.followUpCount), days.length - 1);
      const base = opp.lastOutboundAt && opp.lastOutboundAt.getTime() > stageAt.getTime() ? opp.lastOutboundAt : stageAt;
      return {
        type: "quote_follow_up",
        at: new Date(base.getTime() + days[idx] * 86_400_000),
        reason: `报价后第 ${idx + 1} 次跟进（${days.join("/")} 天节奏）`,
      };
    }
    case "sample":
      return {
        type: "sample_follow_up",
        at: addBusinessDays(opp.lastInteractionAt ?? stageAt, fu.sampleDeliveredFollowUpBusinessDays),
        reason: `样品送达后 ${fu.sampleDeliveredFollowUpBusinessDays} 个工作日跟进`,
      };
    case "negotiation":
      return {
        type: "negotiation_follow_up",
        at: addBusinessDays(opp.lastInteractionAt ?? stageAt, fu.negotiationFollowUpBusinessDays),
        reason: `谈判阶段 ${fu.negotiationFollowUpBusinessDays} 个工作日无动作即跟进`,
      };
    default:
      return null;
  }
}

/** 写回 SalesOpportunity（nextFollowupAt 复用既有列 = nextActionAt） */
export async function applyNextAction(
  orgId: string,
  opportunityId: string,
  opts?: { policy?: RevenueSpinePolicy; now?: Date },
): Promise<NextAction | null> {
  const opp = await db.salesOpportunity.findFirst({
    where: { id: opportunityId, orgId },
    select: {
      stage: true,
      createdAt: true,
      stageChangedAt: true,
      lastInteractionAt: true,
      lastCustomerReplyAt: true,
      lastOutboundAt: true,
      followUpCount: true,
    },
  });
  if (!opp) return null;
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const next = computeNextAction(opp, policy, opts?.now);
  await db.salesOpportunity.update({
    where: { id: opportunityId },
    data: next
      ? { nextActionType: next.type, nextFollowupAt: next.at, nextActionReason: next.reason }
      : { nextActionType: null, nextFollowupAt: null, nextActionReason: null },
  });
  return next;
}

export function isStale(opp: { stage: string; lastInteractionAt: Date | null; createdAt: Date }, policy: RevenueSpinePolicy, now: Date = new Date()): boolean {
  if (!isOpenStage(opp.stage)) return false;
  const last = opp.lastInteractionAt ?? opp.createdAt;
  return now.getTime() - last.getTime() > policy.followUp.staleAfterDays * 86_400_000;
}
