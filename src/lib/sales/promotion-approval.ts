export type PromotionApprovalSnapshot = {
  specialPromotion: number | null;
  finalDiscountPct: number | null;
  promotionApprovalStatus: string;
  promotionApprovalAmount: number | null;
  promotionApprovalRatio: number | null;
  promotionApprovalMaxPct: number | null;
};

const EPSILON = 0.0001;

function sameNumber(a: number | null | undefined, b: number | null | undefined) {
  return a != null && b != null && Math.abs(a - b) <= EPSILON;
}

export function evaluatePromotionApproval(
  quote: PromotionApprovalSnapshot,
  currentMaxPct: number,
) {
  const amount = Math.max(0, quote.specialPromotion ?? 0);
  const ratio = Math.max(0, quote.finalDiscountPct ?? 0);
  const required = ratio > currentMaxPct;
  if (!required) return { required: false, approved: true, reason: null };
  const approved = quote.promotionApprovalStatus === "approved"
    && sameNumber(quote.promotionApprovalAmount, amount)
    && sameNumber(quote.promotionApprovalRatio, ratio)
    && quote.promotionApprovalMaxPct != null
    && ratio > quote.promotionApprovalMaxPct;
  const reason = approved
    ? null
    : quote.promotionApprovalStatus === "pending"
      ? "超额 Special Promotion 正在等待管理员审批"
      : quote.promotionApprovalStatus === "rejected"
        ? "超额 Special Promotion 已被管理员驳回，请调整后重新提交"
        : "超额 Special Promotion 尚未获得管理员批准";
  return { required, approved, reason };
}
