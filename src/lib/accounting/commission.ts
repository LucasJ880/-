/**
 * PERM-5a：提成口径（唯一实现）——本人提成接口与会计全员汇总共用
 *
 *   真实毛利 = Σ(SalesQuoteItem.price − costPrice)（仅含有成本快照的行）
 *   提成 = 真实毛利 × commissionRate；金额四舍五入到分
 * 无成本快照的行计入 itemsTotal 不计入 itemsCosted，如实展示覆盖率，绝不虚构。
 * 调用方负责筛选（status = signed、signedAt 落月）。
 */

export type CommissionQuoteInput = {
  grandTotal: number;
  items: ReadonlyArray<{ price: number; costPrice: number | null }>;
};

export type CommissionSummary = {
  quotesSigned: number;
  quotesWithCost: number;
  itemsCosted: number;
  itemsTotal: number;
  /** 成交金额 = Σ grandTotal */
  signedAmount: number;
  realMargin: number;
  realCommission: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function summarizeCommission(
  quotes: ReadonlyArray<CommissionQuoteInput>,
  commissionRate: number,
): CommissionSummary {
  let realMargin = 0;
  let signedAmount = 0;
  let quotesWithCost = 0;
  let itemsCosted = 0;
  let itemsTotal = 0;
  for (const quote of quotes) {
    signedAmount += quote.grandTotal;
    let quoteCosted = false;
    for (const item of quote.items) {
      itemsTotal += 1;
      if (item.costPrice != null) {
        realMargin += item.price - item.costPrice;
        itemsCosted += 1;
        quoteCosted = true;
      }
    }
    if (quoteCosted) quotesWithCost += 1;
  }
  realMargin = cents(realMargin);
  return {
    quotesSigned: quotes.length,
    quotesWithCost,
    itemsCosted,
    itemsTotal,
    signedAmount: cents(signedAmount),
    realMargin,
    realCommission: cents(realMargin * commissionRate),
  };
}

export type SalesCommissionRow = CommissionSummary & { salesUserId: string };

/** 按创建人（销售）分组；按成交金额倒序，同额按 id 保证确定性 */
export function groupCommissionBySales(
  quotes: ReadonlyArray<CommissionQuoteInput & { createdById: string }>,
  commissionRate: number,
): SalesCommissionRow[] {
  const bySales = new Map<string, CommissionQuoteInput[]>();
  for (const q of quotes) {
    if (!bySales.has(q.createdById)) bySales.set(q.createdById, []);
    bySales.get(q.createdById)!.push(q);
  }
  return [...bySales.entries()]
    .map(([salesUserId, qs]) => ({ salesUserId, ...summarizeCommission(qs, commissionRate) }))
    .sort((a, b) => b.signedAmount - a.signedAmount || a.salesUserId.localeCompare(b.salesUserId));
}
