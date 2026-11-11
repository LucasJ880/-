/**
 * TI-2 两套成本情景对账（纯函数）
 *
 * 只列差额与口径差异，不给「哪套更好」：口径不同的两套模型没有可比的单一指标，
 * 选哪套是 Owner 的决定。差额 = 乙 − 甲。
 */
import { Prisma } from "@prisma/client";
import { FREIGHT_MODE_LABELS_ZH, type ScenarioResult, type ScenarioTotals } from "./contract";

type D = Prisma.Decimal;

export const RECONCILE_BUCKETS: ReadonlyArray<{ key: keyof ScenarioTotals; labelZh: string }> = [
  { key: "goodsCad", labelZh: "货值" },
  { key: "dutyCad", labelZh: "关税" },
  { key: "freightCad", labelZh: "运费" },
  { key: "localDeliveryCad", labelZh: "本地配送" },
  { key: "otherCad", labelZh: "其它" },
  { key: "nonRecoverableTaxCad", labelZh: "不可抵扣税" },
  { key: "reserveInCostCad", labelZh: "预备金（计入成本）" },
  { key: "directCostCad", labelZh: "直接成本" },
  { key: "reserveOnSaleCad", labelZh: "预备金（按售价留）" },
  { key: "profitCad", labelZh: "利润" },
  { key: "bidExclHstCad", labelZh: "报价（不含 HST）" },
];

export type ReconcileRow = { key: string; labelZh: string; a: string; b: string; delta: string };

export type Reconciliation =
  | {
      ok: true;
      a: { key: string; label: string };
      b: { key: string; label: string };
      rows: ReconcileRow[];
      bidDelta: string;
      costDelta: string;
      /** 两套情景在口径上的不同（预备金、运费方案、定价口径、完整性） */
      differences: string[];
    }
  | { ok: false; code: "LINE_SET_MISMATCH"; messageZh: string };

const modesOf = (s: ScenarioResult) => [...new Set(s.meta.reserveModes.map((r) => r.mode))].sort().join("+") || "无";
const freightOf = (s: ScenarioResult) => s.meta.freightModes.map((m) => FREIGHT_MODE_LABELS_ZH[m]).join("+") || "未设方案";
const reserveZh = (m: string) => m.replace("ON_SALE", "按售价留").replace("IN_COST", "计入成本");

export function reconcileScenarios(a: ScenarioResult, b: ScenarioResult): Reconciliation {
  const linesA = a.lines.map((l) => l.lineNo).join(",");
  const linesB = b.lines.map((l) => l.lineNo).join(",");
  if (linesA !== linesB) {
    return { ok: false, code: "LINE_SET_MISMATCH", messageZh: "两套情景的行项不同，不能对账" };
  }
  const rows: ReconcileRow[] = RECONCILE_BUCKETS.map(({ key, labelZh }) => {
    const va = a.totals[key] as D;
    const vb = b.totals[key] as D;
    return { key, labelZh, a: va.toFixed(2), b: vb.toFixed(2), delta: vb.minus(va).toFixed(2) };
  });
  const differences: string[] = [];
  if (modesOf(a) !== modesOf(b)) differences.push(`预备金口径不同：甲「${reserveZh(modesOf(a))}」，乙「${reserveZh(modesOf(b))}」`);
  if (freightOf(a) !== freightOf(b)) differences.push(`运费方案不同：甲「${freightOf(a)}」，乙「${freightOf(b)}」`);
  if (a.meta.pricingMethod !== b.meta.pricingMethod) differences.push("定价口径不同：一套按售价毛利率，一套成本加成");
  else if (!a.meta.pricingRatePct.eq(b.meta.pricingRatePct)) differences.push(`定价比率不同：甲 ${a.meta.pricingRatePct.toString()}%，乙 ${b.meta.pricingRatePct.toString()}%`);
  if (a.flags.incomplete || b.flags.incomplete) differences.push("至少一套情景不完整：差额只含已算出成本的行");
  return {
    ok: true,
    a: { key: a.key, label: a.label },
    b: { key: b.key, label: b.label },
    rows,
    bidDelta: b.totals.bidExclHstCad.minus(a.totals.bidExclHstCad).toFixed(2),
    costDelta: b.totals.directCostCad.minus(a.totals.directCostCad).toFixed(2),
    differences,
  };
}
