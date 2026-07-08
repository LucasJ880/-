/**
 * 报价单对客展示金额 — 单一来源
 *
 * 背景：SalesQuote.grandTotal 由服务端定价引擎计算，在 shell/partial 保存、
 * Part B 附加项、特殊让利等场景下与销售端表单实算金额不一致（甚至为 0）。
 * 销售端表单快照（formDataJson）里的金额才是发给客户的权威数字，
 * 邮件与公开分享页统一从这里取数。
 *
 * 取数优先级：
 * - 总价：表单实算 displayGrandTotal > 定金+尾款之和 > DB grandTotal
 * - 定金/尾款：表单原始填写值；尾款填了非数字（如 "N/A"）时保留原文以便原样展示
 */

export interface QuoteDisplayAmounts {
  /** 对客总价 */
  total: number;
  /** 现在需支付的定金；表单未填时为 null */
  deposit: number | null;
  /** 尾款（数字）；填的是非数字（如 N/A）或未填时为 null */
  balance: number | null;
  /** 尾款显示文本：balance 为 null 但销售填了内容（如 "N/A"）时原样展示 */
  balanceText: string | null;
}

function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

export function deriveQuoteDisplayAmounts(
  formDataJson: string | null | undefined,
  dbGrandTotal: number,
): QuoteDisplayAmounts {
  const fallbackTotal = Number.isFinite(dbGrandTotal) ? dbGrandTotal : 0;

  let form: Record<string, unknown> | null = null;
  if (formDataJson && typeof formDataJson === "string") {
    try {
      const parsed = JSON.parse(formDataJson) as unknown;
      if (parsed && typeof parsed === "object") {
        form = parsed as Record<string, unknown>;
      }
    } catch {
      // 忽略损坏的快照，回退 DB 值
    }
  }

  if (!form) {
    return { total: fallbackTotal, deposit: null, balance: null, balanceText: null };
  }

  const deposit = parseMoney(form.depositAmount);
  const balance = parseMoney(form.balanceAmount);
  const balanceRaw =
    typeof form.balanceAmount === "string" ? form.balanceAmount.trim() : "";
  const balanceText = balance === null && balanceRaw ? balanceRaw : null;

  const clientTotal = parseMoney(form.displayGrandTotal);

  let total = fallbackTotal;
  if (clientTotal !== null && clientTotal > 0) {
    total = clientTotal;
  } else if (deposit !== null && balance !== null && deposit + balance > 0) {
    total = Number((deposit + balance).toFixed(2));
  }

  return { total, deposit, balance, balanceText };
}
