export const TRADE_SAMPLE_STATUSES = ["requested", "preparing", "shipped", "cancelled"] as const;
export type TradeSampleStatus = (typeof TRADE_SAMPLE_STATUSES)[number];

/** 寄出后几个工作日进入「等买家回」盯办 */
export const SAMPLE_FOLLOW_UP_BUSINESS_DAYS = 5;

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

function asTime(v?: Date | string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 已寄出、人未点已跟进、寄出后买家还没再进线 */
export function isSampleWaitingReply(input: {
  status: string;
  shippedAt?: Date | string | null;
  followedUpAt?: Date | string | null;
  lastInboundAt?: Date | string | null;
}): boolean {
  if (input.status !== "shipped") return false;
  if (asTime(input.followedUpAt) != null) return false;
  const shipped = asTime(input.shippedAt);
  if (shipped == null) return false;
  const inbound = asTime(input.lastInboundAt);
  if (inbound != null && inbound >= shipped) return false;
  return true;
}
