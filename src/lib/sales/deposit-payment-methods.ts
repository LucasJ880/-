export const DEPOSIT_PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash（现金）" },
  { value: "visa", label: "Visa" },
  { value: "check", label: "支票（Cheque）" },
  { value: "finance", label: "Finance（融资）" },
] as const;

export type DepositPaymentMethod =
  (typeof DEPOSIT_PAYMENT_METHOD_OPTIONS)[number]["value"];

export const DEPOSIT_PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash（现金）",
  visa: "Visa",
  check: "支票（Cheque）",
  finance: "Finance（融资）",
  // 兼容更新前已经登记的订单。
  etransfer: "Email Transfer",
};

const CURRENT_METHODS = new Set<string>(
  DEPOSIT_PAYMENT_METHOD_OPTIONS.map((option) => option.value),
);

/** API 继续接收旧客户端的 etransfer，避免部署切换期间登记失败。 */
export function isAcceptedDepositPaymentMethod(
  value: string,
): value is DepositPaymentMethod | "etransfer" {
  return CURRENT_METHODS.has(value) || value === "etransfer";
}

export function getDepositPaymentMethodLabel(value: string): string {
  return DEPOSIT_PAYMENT_METHOD_LABEL[value] ?? value;
}
