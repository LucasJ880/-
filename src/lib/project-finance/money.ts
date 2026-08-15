/**
 * T2-P1.6 货币 / 汇率核心 — 唯一权威换算实现（server-side，纯 Decimal）
 *
 * 冻结口径：
 * - BASE_CURRENCY = "CAD"。Budget / Actual / Revenue / Profit / Margin / Portfolio 最终一律 CAD 汇总。
 * - 汇率方向**唯一**：`fxRateCadPerOriginalUnit` = 1 单位原始币种 = X CAD。
 *   刻意不提供 `fxRate` 这种无方向命名，也不提供 reciprocal 入口 —— 结构性杜绝 inverse-rate bug。
 * - 原始币种 + 原始金额永久保留（存 ProjectExpenseSubmission.currency / totalAmount），
 *   换算结果只前向写入独立列（estimatedCadAmount），**绝不覆盖原始数据**。
 * - 历史成本一旦快照，禁止按当日汇率重算（本文件不提供「取今日汇率」的入口）。
 * - 全部金额使用 Prisma.Decimal；禁止 JS number 参与权威财务计算
 *   （number 仅允许出现在展示层与非权威 indicative 统计，且必须显式标注）。
 */
import { Prisma } from "@prisma/client";

/** 经营核算基准币种（RULE 3）。 */
export const BASE_CURRENCY = "CAD" as const;

/** P0 支持币种（UI 选择器）。新增币种只需扩此表 + 提供汇率来源。 */
export const SUPPORTED_EXPENSE_CURRENCIES = ["CAD", "CNY", "USD"] as const;
export type SupportedExpenseCurrency = (typeof SUPPORTED_EXPENSE_CURRENCIES)[number];

/**
 * 汇率来源（RULE 4 §6.1）。
 * - BASE_CURRENCY  ：原始币种即 CAD，rate 恒 1，不走 FX 流程
 * - MANUAL         ：人工输入（P0 必须支持）
 * - SYSTEM_REFERENCE：系统参考汇率（当前无 provider；接口预留，见 fx.ts）
 * - BANK_SETTLEMENT：银行实际成交汇率（最终结算）
 */
export const FX_RATE_SOURCES = [
  "BASE_CURRENCY",
  "MANUAL",
  "SYSTEM_REFERENCE",
  "BANK_SETTLEMENT",
] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/** 金额列精度（Decimal(18,2)）。 */
export const MONEY_SCALE = 2;
/** 汇率列精度（Decimal(18,8)）。 */
export const FX_RATE_SCALE = 8;

export type DecimalInput = Prisma.Decimal | string | number;

export function dec(v: DecimalInput): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

export const ZERO = new Prisma.Decimal(0);
export const ONE = new Prisma.Decimal(1);

/** 金额四舍五入到 2 位（ROUND_HALF_UP —— 与会计惯例一致，且与 DB Decimal(18,2) 落库一致）。 */
export function roundMoney(v: DecimalInput): Prisma.Decimal {
  return dec(v).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** 汇率规范化到 8 位。 */
export function roundFxRate(v: DecimalInput): Prisma.Decimal {
  return dec(v).toDecimalPlaces(FX_RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** 币种规范化（大写 trim）；空 → null。 */
export function normalizeCurrency(c: string | null | undefined): string | null {
  const s = (c ?? "").trim().toUpperCase();
  return s.length > 0 ? s : null;
}

export function isBaseCurrency(c: string | null | undefined): boolean {
  return normalizeCurrency(c) === BASE_CURRENCY;
}

/** 货币换算契约违规（方向 / 精度 / 合法性）。 */
export class FxContractError extends Error {
  readonly code = "FX_CONTRACT_VIOLATION";
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "FxContractError";
  }
}

/**
 * 汇率合法性（FX-05：结构性杜绝 inverse-rate 歧义）。
 * - 必须为有限正数
 * - 原始币种 = CAD 时必须恰好 1（不接受 0.99999999 之类的「近似 1」，否则等于允许 CAD 被隐式换算）
 */
export function assertFxRate(
  rate: DecimalInput,
  originalCurrency: string,
): Prisma.Decimal {
  const r = dec(rate);
  if (!r.isFinite() || r.lte(0)) {
    throw new FxContractError(
      `汇率必须为正有限数（fxRateCadPerOriginalUnit=1 单位 ${originalCurrency} 折合多少 CAD）；收到 ${r.toString()}`,
    );
  }
  if (isBaseCurrency(originalCurrency) && !r.equals(ONE)) {
    throw new FxContractError(
      `原始币种为 ${BASE_CURRENCY} 时汇率必须恰为 1（收到 ${r.toString()}）；${BASE_CURRENCY} 费用不得走换算流程`,
    );
  }
  return roundFxRate(r);
}

/**
 * 唯一换算入口（FX-01/02/06）：CAD = 原始金额 × fxRateCadPerOriginalUnit，四舍五入到分。
 * 语义固定：rate 是「1 单位 ORIGINAL 币种 = X CAD」。
 */
export function convertToCad(input: {
  originalAmount: DecimalInput;
  originalCurrency: string;
  fxRateCadPerOriginalUnit: DecimalInput;
}): Prisma.Decimal {
  const amount = dec(input.originalAmount);
  if (!amount.isFinite()) {
    throw new FxContractError("金额必须为有限数");
  }
  const rate = assertFxRate(input.fxRateCadPerOriginalUnit, input.originalCurrency);
  // CAD 短路（§6.2）：不做乘法，避免任何精度噪声进入基准币种金额
  if (isBaseCurrency(input.originalCurrency)) return roundMoney(amount);
  return roundMoney(amount.mul(rate));
}

/** 最终 CAD 成本 = 银行入账本金 + 银行/电汇手续费（FX-04）。 */
export function computeFinalCad(input: {
  settledCadAmount: DecimalInput;
  bankFeeCad?: DecimalInput | null;
}): Prisma.Decimal {
  const settled = dec(input.settledCadAmount);
  const fee = input.bankFeeCad != null ? dec(input.bankFeeCad) : ZERO;
  if (!settled.isFinite() || settled.lte(0)) {
    throw new FxContractError("银行实际结算 CAD 金额必须为正");
  }
  if (!fee.isFinite() || fee.lt(0)) {
    throw new FxContractError("银行手续费不得为负");
  }
  return roundMoney(settled.add(fee));
}

/**
 * legacy-safe 的「这笔费用的权威 CAD 金额」解析（P1.5 既有行全部走 legacy 分支）。
 *
 * - `estimatedCadAmount` 有值 → 直接用（P1.6 新行，含 FX 快照）
 * - 无值且 currency = CAD    → totalAmount（legacy 语义：P1.5 只支持单币种录入）
 * - 无值且 currency ≠ CAD    → **UNKNOWN**：不猜、不按今日汇率补算，交由调用方排除并计数
 */
export type ExpenseCadResolution =
  | { known: true; cad: Prisma.Decimal; legacy: boolean }
  | { known: false; reason: "MISSING_FX_SNAPSHOT"; currency: string };

export function resolveExpenseCad(expense: {
  totalAmount: Prisma.Decimal;
  currency: string;
  estimatedCadAmount?: Prisma.Decimal | null;
}): ExpenseCadResolution {
  if (expense.estimatedCadAmount != null) {
    return { known: true, cad: roundMoney(expense.estimatedCadAmount), legacy: false };
  }
  if (isBaseCurrency(expense.currency)) {
    return { known: true, cad: roundMoney(expense.totalAmount), legacy: true };
  }
  return {
    known: false,
    reason: "MISSING_FX_SNAPSHOT",
    currency: normalizeCurrency(expense.currency) ?? "",
  };
}

/** 求和辅助（Decimal 累加；空数组 → 0）。 */
export function sumDecimal(values: Iterable<Prisma.Decimal | null | undefined>): Prisma.Decimal {
  let total = ZERO;
  for (const v of values) if (v != null) total = total.add(v);
  return total;
}

/**
 * 毛利率（百分比，保留 2 位）。收入为 0 / 负 → null（禁止除零，禁止造出无意义的 margin）。
 * 返回 string 以避免在权威口径上引入 JS float。
 */
export function marginPercentage(
  profit: Prisma.Decimal,
  revenue: Prisma.Decimal,
): string | null {
  if (revenue.lte(0)) return null;
  return profit.div(revenue).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString();
}
