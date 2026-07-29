import type { HandoffAmountInfo } from "./types";

/**
 * 合同金额仅来自可靠来源。
 * 优先：winningBidPrice（中标价）→ 否则为空。
 * 禁止：草稿报价、成本推算、AI 猜测。
 * ourBidPrice 仅在同时存在 awardDate 且用户已标记 won 时作为「待确认」提示，不自动确认。
 */
export function resolveHandoffContractAmount(project: {
  winningBidPrice: number | null | undefined;
  ourBidPrice: number | null | undefined;
  currency: string | null | undefined;
  awardDate: Date | null | undefined;
  tenderStatus: string | null | undefined;
}): HandoffAmountInfo {
  const currency = project.currency?.trim() || null;

  if (
    project.winningBidPrice != null &&
    Number.isFinite(project.winningBidPrice) &&
    project.winningBidPrice > 0
  ) {
    return {
      amount: project.winningBidPrice,
      currency,
      source: "winning_bid_price",
      label: "中标价 / 成交价",
      confirmed: true,
    };
  }

  return {
    amount: null,
    currency,
    source: "none",
    label: "合同金额：尚未确认",
    confirmed: false,
  };
}
