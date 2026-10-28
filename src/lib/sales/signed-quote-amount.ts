/**
 * PERM-4a：已签约报价改总价的审批判定（纯函数，不连库）
 *
 * - 已签约（signed / accepted）且新总价与当前差 > 0.005 → 需要审批；平台 super_admin 直接生效
 * - 审批标题 / 预览只含报价号、客户名、改前改后总价、提交人（spec：不含成本 / 毛利）
 */

export const SIGNED_QUOTE_ACTION_TYPE = "sales.update_signed_quote" as const;
export const SIGNED_QUOTE_APPROVE_PERMISSION = "sales.quote.signed_amount.approve" as const;
export const SIGNED_QUOTE_STATUSES: ReadonlySet<string> = new Set(["signed", "accepted"]);
export const SIGNED_TOTAL_EPSILON = 0.005;

export function signedTotalChanged(currentTotal: number, nextTotal: number): boolean {
  return Math.abs((nextTotal ?? 0) - (currentTotal ?? 0)) > SIGNED_TOTAL_EPSILON;
}

export type SignedAmountDecision = "not_signed" | "total_unchanged" | "platform_direct" | "approval_required";

export function decideSignedAmountChange(input: {
  status: string;
  currentTotal: number;
  nextTotal: number;
  isPlatformSuperAdmin: boolean;
}): SignedAmountDecision {
  if (!SIGNED_QUOTE_STATUSES.has(input.status)) return "not_signed";
  if (!signedTotalChanged(input.currentTotal, input.nextTotal)) return "total_unchanged";
  return input.isPlatformSuperAdmin ? "platform_direct" : "approval_required";
}

const money = (n: number) => `$${(Math.round((n ?? 0) * 100) / 100).toFixed(2)}`;

export function describeSignedQuoteChange(input: {
  quoteNumber: string | null;
  customerName: string | null;
  beforeTotal: number;
  afterTotal: number;
  requesterName: string;
}): { title: string; preview: string } {
  const label = input.quoteNumber?.trim() || "（无单号）";
  const customer = input.customerName?.trim() ? `（${input.customerName.trim()}）` : "";
  return {
    title: `审批签约单改价 ${label}`,
    preview: `${input.requesterName} 申请修改已签约报价 ${label}${customer} 的总价：${money(input.beforeTotal)} → ${money(input.afterTotal)}；批准后原签名作废，报价回到草稿重新发送签署`,
  };
}

/**
 * 幂等键 = 报价 + 提交时版本 + 第几次提交（该报价已有的改价审批条数）。
 * 并发重复提交算出同一个键 → 只建一条；被拒 / 失败后再提交 → 条数 +1 → 新审批（drafts 层按键去重不看状态）。
 */
export function signedQuoteIdempotencyKey(quoteId: string, baseUpdatedAt: string, attempt: number): string {
  return `signed-quote-amount:${quoteId}:${baseUpdatedAt}:${attempt}`;
}
