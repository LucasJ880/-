/**
 * 价格差距计算：同时保存「中标价/我方」与「我方相对中标高/低」两种比例
 */

export type PriceGapAnalysis = {
  ourBidPrice: number;
  winningBidPrice: number;
  /** 中标价为我方报价的百分比，如 80 表示 80% */
  winningAsPctOfOurs: number;
  /** 我方相对中标价的溢价百分比，如 25 表示高 25% */
  oursPremiumPctVsWinning: number;
  absoluteDiff: number;
  currency: string | null;
  summaryLines: string[];
};

export function computePriceGap(input: {
  ourBidPrice: number | null | undefined;
  winningBidPrice: number | null | undefined;
  currency?: string | null;
}): PriceGapAnalysis | null {
  const ours = input.ourBidPrice;
  const win = input.winningBidPrice;
  if (
    ours == null ||
    win == null ||
    !Number.isFinite(ours) ||
    !Number.isFinite(win) ||
    ours <= 0 ||
    win <= 0
  ) {
    return null;
  }

  const winningAsPctOfOurs = Math.round((win / ours) * 10000) / 100;
  const oursPremiumPctVsWinning = Math.round(((ours - win) / win) * 10000) / 100;
  const absoluteDiff = Math.round((ours - win) * 100) / 100;
  const currency = input.currency ?? null;
  const cur = currency ? ` ${currency}` : "";

  return {
    ourBidPrice: ours,
    winningBidPrice: win,
    winningAsPctOfOurs,
    oursPremiumPctVsWinning,
    absoluteDiff,
    currency,
    summaryLines: [
      `我方报价：${ours.toLocaleString()}${cur}`,
      `中标价：${win.toLocaleString()}${cur}`,
      `中标价为我方报价的 ${winningAsPctOfOurs}%`,
      oursPremiumPctVsWinning >= 0
        ? `我方比中标价高 ${oursPremiumPctVsWinning}%`
        : `我方比中标价低 ${Math.abs(oursPremiumPctVsWinning)}%`,
      `绝对价差为 ${Math.abs(absoluteDiff).toLocaleString()}${cur}`,
    ],
  };
}
