/**
 * TI-2 核算表视图（纯数据；界面、PDF、表格导出都从它渲染，数字只算一次）
 *
 * 四块：行项（进口 / 本地分组与小计）、合计、假设与出处、阻断与提示。
 * 视图里的金额已格式化为字符串；为空的金额显示「—」，不显示 0。
 */
import { Prisma } from "@prisma/client";
import { ZERO } from "@/lib/project-finance/money";
import {
  QUOTE_EVIDENCE_LABELS_ZH, type AssumptionEntry, type PricedLine, type ScenarioResult, type SourcingType,
} from "./contract";

type D = Prisma.Decimal;
export const EMPTY_CELL = "—";
export const TAX_NOTE = "不含 HST" as const;

export function fmtMoney(v: D | null | undefined): string {
  if (!v) return EMPTY_CELL;
  const [int, frac] = v.toFixed(2).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  return `${sign}${int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
export function fmtPct(v: D | null | undefined): string {
  return v ? `${v.toFixed(1)}%` : EMPTY_CELL;
}
function fmtCount(v: D | null | undefined): string {
  if (!v) return EMPTY_CELL;
  const s = v.toString();
  const [int, frac] = s.split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

export type CostSheetRow = {
  lineNo: number;
  description: string;
  quantity: string;
  quote: string;
  evidence: string;
  goods: string;
  duty: string;
  freight: string;
  localDelivery: string;
  /** 其它不可回收成本 + 不可抵扣税 + 计入成本的预备金（三项在合计块分列） */
  other: string;
  directCost: string;
  unitCost: string;
  unitBid: string;
  extended: string;
  profit: string;
  grossMarginPct: string;
  marks: string[];
};

export type CostSheetSubtotal = Pick<CostSheetRow, "goods" | "duty" | "freight" | "localDelivery" | "other" | "directCost" | "extended" | "profit">;

export type CostSheetGroup = { key: SourcingType; labelZh: string; rows: CostSheetRow[]; subtotal: CostSheetSubtotal };

export type CostSheetView = {
  title: string;
  scenarioLabel: string;
  groups: CostSheetGroup[];
  totals: {
    directCost: string;
    bidExclHst: string;
    profit: string;
    grossMarginPct: string;
    markupPct: string;
    netMarginPct: string;
    importGstCash: string;
    reserveOnSale: string;
    nonRecoverableTax: string;
    reserveInCost: string;
    taxNote: typeof TAX_NOTE;
    marks: string[];
  };
  assumptions: AssumptionEntry[];
  blockers: Array<{ lineNo: number; description: string; reasons: string[] }>;
  notices: string[];
};

export const MARK_INCOMPLETE = "不完整";
export const MARK_SENSITIVITY_DUTY = "含未核实的关税假设";
export const MARK_INDICATIVE_PRICE = "含指示性价格";

const GROUP_LABELS: Record<SourcingType, string> = { IMPORT: "进口", DOMESTIC: "本地" };
const otherOf = (l: PricedLine): D | null =>
  l.complete ? (l.otherCad ?? ZERO).plus(l.nonRecoverableTaxCad ?? ZERO).plus(l.reserveInCostCad ?? ZERO) : null;
const add = (vals: Array<D | null>): D => vals.reduce<D>((a, v) => (v ? a.plus(v) : a), ZERO);

function toRow(l: PricedLine): CostSheetRow {
  const marks: string[] = [];
  if (l.excessPieces && l.excessPieces.gt(ZERO)) marks.push(`超购 ${fmtCount(l.excessPieces)} 件`);
  if (l.sourcing === "IMPORT" && l.dutyBasis === "SENSITIVITY") marks.push(MARK_SENSITIVITY_DUTY);
  if (!l.complete) marks.push(l.blockers.map((b) => b.messageZh).join("、"));
  return {
    lineNo: l.lineNo,
    description: l.description,
    quantity: `${fmtCount(l.quantity)} ${l.uom}`,
    quote: l.quoteUnitPrice && l.quoteCurrency ? `${l.quoteUnitPrice.toFixed(2)} ${l.quoteCurrency}/${l.quoteBasis === "PER_PIECE" ? "件" : l.uom}` : EMPTY_CELL,
    evidence: l.evidenceKind ? QUOTE_EVIDENCE_LABELS_ZH[l.evidenceKind] : EMPTY_CELL,
    goods: fmtMoney(l.goodsCad),
    duty: fmtMoney(l.dutyCad),
    freight: fmtMoney(l.freightCad),
    localDelivery: fmtMoney(l.localDeliveryCad),
    other: fmtMoney(otherOf(l)),
    directCost: fmtMoney(l.directCostCad),
    unitCost: fmtMoney(l.unitCostCad),
    unitBid: fmtMoney(l.unitBidCad),
    extended: fmtMoney(l.extendedBidCad),
    profit: fmtMoney(l.profitCad),
    grossMarginPct: fmtPct(l.grossMarginPct),
    marks,
  };
}

export function buildCostSheetView(result: ScenarioResult, opts?: { title?: string }): CostSheetView {
  const groups: CostSheetGroup[] = (["IMPORT", "DOMESTIC"] as const)
    .map((key) => {
      const lines = result.lines.filter((l) => l.sourcing === key);
      const done = lines.filter((l) => l.complete);
      return {
        key,
        labelZh: GROUP_LABELS[key],
        rows: lines.map(toRow),
        subtotal: {
          goods: fmtMoney(add(done.map((l) => l.goodsCad))),
          duty: fmtMoney(add(done.map((l) => l.dutyCad))),
          freight: fmtMoney(add(done.map((l) => l.freightCad))),
          localDelivery: fmtMoney(add(done.map((l) => l.localDeliveryCad))),
          other: fmtMoney(add(done.map(otherOf))),
          directCost: fmtMoney(add(done.map((l) => l.directCostCad))),
          extended: fmtMoney(add(done.map((l) => l.extendedBidCad))),
          profit: fmtMoney(add(done.map((l) => l.profitCad))),
        },
      };
    })
    .filter((g) => g.rows.length > 0);

  const marks: string[] = [];
  if (result.flags.incomplete) marks.push(MARK_INCOMPLETE);
  if (result.flags.hasSensitivityDuty) marks.push(MARK_SENSITIVITY_DUTY);
  if (result.flags.hasIndicativePrice) marks.push(MARK_INDICATIVE_PRICE);
  const t = result.totals;
  return {
    title: opts?.title ?? "成本核算表",
    scenarioLabel: result.label,
    groups,
    totals: {
      directCost: fmtMoney(t.directCostCad),
      bidExclHst: fmtMoney(t.bidExclHstCad),
      profit: fmtMoney(t.profitCad),
      grossMarginPct: fmtPct(t.grossMarginPct),
      markupPct: fmtPct(t.markupPct),
      netMarginPct: fmtPct(t.netMarginPct),
      importGstCash: fmtMoney(t.importGstCashCad),
      reserveOnSale: fmtMoney(t.reserveOnSaleCad),
      nonRecoverableTax: fmtMoney(t.nonRecoverableTaxCad),
      reserveInCost: fmtMoney(t.reserveInCostCad),
      taxNote: TAX_NOTE,
      marks,
    },
    assumptions: result.assumptions,
    blockers: result.lines.filter((l) => !l.complete).map((l) => ({ lineNo: l.lineNo, description: l.description, reasons: l.blockers.map((b) => b.messageZh) })),
    notices: [...result.notices, ...(result.meta.freightBlendNote ? [`运费方案为混合：${result.meta.freightBlendNote}`] : [])],
  };
}
