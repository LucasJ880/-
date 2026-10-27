/**
 * PERM-2：报价折扣三档判定（纯函数）
 *
 *   折扣 ≤ promoMaxPct                                  → within_limit（不需审批）
 *   promoMaxPct < 折扣 ≤ leadMaxPct 且持超限提交权      → lead_direct（直接 approved，审计 via pricing_lead）
 *   平台 super_admin 且折扣 > promoMaxPct               → platform_self_approved（approved，审计 selfApproved）
 *   其余 折扣 > promoMaxPct                             → approval_required（走超限审批）
 *
 * 平台 admin / boss / manager 等角色不在输入里：能力位只来自 authorize()。
 */

export type DiscountTier =
  | "within_limit"
  | "lead_direct"
  | "platform_self_approved"
  | "approval_required";

export type DiscountTierActor = {
  isPlatformSuperAdmin: boolean;
  /** authorize(sales.quote.discount.over_limit.submit) 的结果 */
  canSubmitOverLimit: boolean;
};

export type DiscountTierDecision = {
  tier: DiscountTier;
  /** 是否视为已批准（within_limit 也为 true：不需审批） */
  approved: boolean;
  /** 需要走提交审批流程 */
  requiresApproval: boolean;
  auditVia: "pricing_lead" | "platform_admin_self_approval" | null;
  selfApproved: boolean;
};

export function decideDiscountTier(input: {
  ratio: number | null | undefined;
  promoMaxPct: number;
  leadMaxPct: number;
  actor: DiscountTierActor;
}): DiscountTierDecision {
  const ratio = typeof input.ratio === "number" && Number.isFinite(input.ratio) ? input.ratio : 0;
  const leadMax = Math.max(input.leadMaxPct, input.promoMaxPct);

  if (ratio <= input.promoMaxPct) {
    return { tier: "within_limit", approved: true, requiresApproval: false, auditVia: null, selfApproved: false };
  }
  if (input.actor.canSubmitOverLimit && ratio <= leadMax) {
    return { tier: "lead_direct", approved: true, requiresApproval: false, auditVia: "pricing_lead", selfApproved: false };
  }
  if (input.actor.isPlatformSuperAdmin) {
    return {
      tier: "platform_self_approved",
      approved: true,
      requiresApproval: false,
      auditVia: "platform_admin_self_approval",
      selfApproved: true,
    };
  }
  return { tier: "approval_required", approved: false, requiresApproval: true, auditVia: null, selfApproved: false };
}

/** 写入 salesQuote 的 promotionApproval* 字段（创建与修改共用） */
export function promotionApprovalDataForTier(input: {
  decision: DiscountTierDecision;
  ratio: number | null | undefined;
  amount: number | null | undefined;
  promoMaxPct: number;
  userId: string;
  now?: Date;
}): Record<string, unknown> {
  const ratio = typeof input.ratio === "number" && Number.isFinite(input.ratio) ? Math.max(0, Math.min(1, input.ratio)) : 0;
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
  const now = input.now ?? new Date();
  switch (input.decision.tier) {
    case "within_limit":
      return { promotionApprovalStatus: "not_required" };
    case "lead_direct":
    case "platform_self_approved":
      return {
        promotionApprovalStatus: "approved",
        promotionApprovalAmount: amount,
        promotionApprovalRatio: ratio,
        promotionApprovalMaxPct: input.promoMaxPct,
        promotionApprovedAt: now,
        promotionApprovedById: input.userId,
      };
    case "approval_required":
    default:
      return { promotionApprovalStatus: "required" };
  }
}
