type SortableCustomer = {
  primaryStage?: string | null;
  funnelStatus?: string | null;
  estimatedValue?: number | null;
  nextFollowupAt?: string | null;
  quoteViewed?: boolean;
  latestQuoteStatus?: string | null;
  updatedAt?: string;
};

/** 客户列表默认排序：逾期跟进 → 新线索 → 已看报价 → 高金额 → 最近更新 */
export function sortCustomersForSalesList<T extends SortableCustomer>(
  customers: T[],
): T[] {
  const now = Date.now();

  const score = (c: SortableCustomer): number => {
    let s = 0;
    if (c.nextFollowupAt && new Date(c.nextFollowupAt).getTime() <= now) {
      s += 1000;
    }
    if (c.primaryStage === "new_lead" || c.funnelStatus === "new") {
      s += 400;
    }
    if (c.quoteViewed && c.latestQuoteStatus !== "signed") {
      s += 300;
    }
    const value = c.estimatedValue ?? 0;
    if (value >= 8000) s += 120;
    else if (value >= 4000) s += 80;
    else if (value >= 2000) s += 40;
    const updated = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
    s += Math.min(50, Math.floor(updated / 1e11));
    return s;
  };

  return [...customers].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    const aT = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bT = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bT - aT;
  });
}

export function quoteStatusLabel(
  status: string | null | undefined,
  viewed?: boolean,
): string {
  if (!status) return "无报价";
  if (status === "draft") return "草稿";
  if (status === "sent" && viewed) return "已查看";
  if (status === "sent") return "已发送";
  if (status === "viewed") return "已查看";
  if (status === "signed" || status === "accepted") return "已签约";
  if (status === "rejected" || status === "expired") return "已失效";
  return status;
}
