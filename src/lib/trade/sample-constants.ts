export const TRADE_SAMPLE_STATUSES = ["requested", "preparing", "shipped", "cancelled"] as const;
export type TradeSampleStatus = (typeof TRADE_SAMPLE_STATUSES)[number];

export const TRADE_SAMPLE_STATUS_LABELS: Record<TradeSampleStatus, string> = {
  requested: "已申请",
  preparing: "备样中",
  shipped: "已寄出",
  cancelled: "已取消",
};

export function isTradeSampleStatus(v: string): v is TradeSampleStatus {
  return (TRADE_SAMPLE_STATUSES as readonly string[]).includes(v);
}

export function canTransitionSample(from: TradeSampleStatus, to: TradeSampleStatus): boolean {
  if (from === to) return true;
  if (from === "cancelled" || from === "shipped") return false;
  if (to === "cancelled") return true;
  if (from === "requested" && (to === "preparing" || to === "shipped")) return true;
  if (from === "preparing" && to === "shipped") return true;
  return false;
}
