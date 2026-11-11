/**
 * TI-3a 历史金额口径（纯函数，定点）
 *
 * 评标价、授标值、下单、开票、实付、预算估计是不同的量，不能相加。
 * 口径沿用采购资料模块的词表（procurement-records/labels），补「授标值」「预算估计」两项。
 * 求和只接受同口径同币种；按口径汇总时逐口径分别给合计，不给跨口径的总数。
 */
import { Prisma } from "@prisma/client";
import { ZERO, type DecimalInput } from "@/lib/project-finance/money";
import { AMOUNT_BASES, AMOUNT_BASIS_LABELS } from "@/lib/procurement-records/labels";
import { toDecimalOrNull } from "@/lib/tender-price-schedule/contract";

const BASES_WITHOUT_UNKNOWN = AMOUNT_BASES.filter((b): b is Exclude<(typeof AMOUNT_BASES)[number], "UNKNOWN"> => b !== "UNKNOWN");
export const AMOUNT_MEASURES = [...BASES_WITHOUT_UNKNOWN, "AWARD_VALUE", "ESTIMATE", "UNKNOWN"] as const;
export type AmountMeasure = (typeof AMOUNT_MEASURES)[number];

export const AMOUNT_MEASURE_ZH: Record<AmountMeasure, string> = {
  ...AMOUNT_BASIS_LABELS,
  AWARD_VALUE: "授标值（award value）",
  ESTIMATE: "预算估计（estimate）",
};

export type MeasuredAmount = { measure: AmountMeasure; amount: DecimalInput; currency: string; label?: string | null; sourceRef?: string | null };

type SumFail = { ok: false; code: "EMPTY" | "MIXED_MEASURE" | "MIXED_CURRENCY" | "UNKNOWN_MEASURE" | "INVALID_AMOUNT"; messageZh: string };

const cur = (c: string) => c.trim().toUpperCase();

/** 只接受口径与币种都相同的金额。 */
export function sumSameMeasure(amounts: readonly MeasuredAmount[]): { ok: true; measure: AmountMeasure; currency: string; total: Prisma.Decimal; count: number } | SumFail {
  if (amounts.length === 0) return { ok: false, code: "EMPTY", messageZh: "没有可相加的金额" };
  const measures = [...new Set(amounts.map((a) => a.measure))];
  if (measures.includes("UNKNOWN")) return { ok: false, code: "UNKNOWN_MEASURE", messageZh: "口径未识别的金额不能参与求和" };
  if (measures.length > 1) {
    return { ok: false, code: "MIXED_MEASURE", messageZh: `口径不同不能相加：${measures.map((m) => AMOUNT_MEASURE_ZH[m]).join("、")}` };
  }
  const currencies = [...new Set(amounts.map((a) => cur(a.currency)))];
  if (currencies.length > 1) return { ok: false, code: "MIXED_CURRENCY", messageZh: `币种不同不能相加：${currencies.join("、")}` };
  let total = ZERO;
  for (const a of amounts) {
    const v = toDecimalOrNull(a.amount);
    if (!v) return { ok: false, code: "INVALID_AMOUNT", messageZh: "金额无法解析" };
    total = total.plus(v);
  }
  return { ok: true, measure: measures[0], currency: currencies[0], total, count: amounts.length };
}

export type MeasureGroup = { measure: AmountMeasure; measureZh: string; currency: string; total: string; count: number };

/** 逐口径、逐币种分别汇总。返回值里刻意没有跨口径的合计字段。 */
export function summarizeByMeasure(amounts: readonly MeasuredAmount[]): { groups: MeasureGroup[]; excluded: Array<{ reasonZh: string; count: number }> } {
  const buckets = new Map<string, MeasuredAmount[]>();
  let unknown = 0;
  let invalid = 0;
  for (const a of amounts) {
    if (a.measure === "UNKNOWN") { unknown += 1; continue; }
    if (!toDecimalOrNull(a.amount)) { invalid += 1; continue; }
    const key = `${a.measure}|${cur(a.currency)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  const groups: MeasureGroup[] = [];
  for (const m of AMOUNT_MEASURES) {
    for (const [key, list] of buckets) {
      if (!key.startsWith(`${m}|`)) continue;
      const s = sumSameMeasure(list);
      if (s.ok) groups.push({ measure: s.measure, measureZh: AMOUNT_MEASURE_ZH[s.measure], currency: s.currency, total: s.total.toFixed(2), count: s.count });
    }
  }
  const excluded: Array<{ reasonZh: string; count: number }> = [];
  if (unknown) excluded.push({ reasonZh: "口径未识别，未参与汇总", count: unknown });
  if (invalid) excluded.push({ reasonZh: "金额无法解析，未参与汇总", count: invalid });
  return { groups, excluded };
}
