/**
 * 报价单对客展示金额 — 单一来源
 *
 * 背景：SalesQuote.grandTotal 由服务端定价引擎计算，在 shell/partial 保存、
 * Part B 附加项、特殊让利等场景下与销售端表单实算金额不一致（甚至为 0）。
 * 销售端表单的 deposit + balance（Part B 约定付款）才是发给客户的权威金额，
 * 邮件与公开分享页统一从这里取数。
 */

import { parseAgreedPaymentFromFormDataJson } from "@/lib/sales/quote-agreed-payment";

export interface QuoteDisplayAmounts {
  /** 对客总价：优先 定金+尾款（表单实算），否则回退 DB grandTotal */
  total: number;
  /** 现在需支付的定金；表单未填时为 null */
  deposit: number | null;
  /** 尾款；无法解析时为 null */
  balance: number | null;
}

export function deriveQuoteDisplayAmounts(
  formDataJson: string | null | undefined,
  dbGrandTotal: number,
): QuoteDisplayAmounts {
  const { agreedDepositAmount, agreedBalanceAmount } =
    parseAgreedPaymentFromFormDataJson(formDataJson, dbGrandTotal);

  let total = Number.isFinite(dbGrandTotal) ? dbGrandTotal : 0;
  if (
    agreedDepositAmount !== null &&
    agreedBalanceAmount !== null &&
    agreedDepositAmount + agreedBalanceAmount > 0
  ) {
    total = Number((agreedDepositAmount + agreedBalanceAmount).toFixed(2));
  }

  return { total, deposit: agreedDepositAmount, balance: agreedBalanceAmount };
}
