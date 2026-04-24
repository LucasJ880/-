/**
 * 从报价单 formDataJson（QuoteFormState 序列化）解析 Part B 约定的定金/尾款，
 * 用于 SalesQuote.agreed* 字段与登记定金弹窗预填。
 */

export type AgreedPaymentSnapshot = {
  agreedDepositAmount: number | null;
  agreedBalanceAmount: number | null;
};

function parseMoneyField(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

export function parseAgreedPaymentFromFormDataJson(
  formDataJson: string | null | undefined,
  grandTotal: number,
): AgreedPaymentSnapshot {
  if (!formDataJson || typeof formDataJson !== "string") {
    return { agreedDepositAmount: null, agreedBalanceAmount: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(formDataJson) as unknown;
  } catch {
    return { agreedDepositAmount: null, agreedBalanceAmount: null };
  }
  if (!parsed || typeof parsed !== "object") {
    return { agreedDepositAmount: null, agreedBalanceAmount: null };
  }
  const o = parsed as Record<string, unknown>;
  const agreedDepositAmount = parseMoneyField(o.depositAmount);
  let agreedBalanceAmount = parseMoneyField(o.balanceAmount);

  if (agreedBalanceAmount === null && agreedDepositAmount !== null) {
    const gt = Number.isFinite(grandTotal) ? grandTotal : 0;
    if (gt > 0) {
      agreedBalanceAmount = Number(Math.max(0, gt - agreedDepositAmount).toFixed(2));
    }
  }

  return { agreedDepositAmount, agreedBalanceAmount };
}
