/**
 * TI-1 按官方价格表原样导出（纯函数）
 *
 * 行数、行序、行号、说明、单位、数量与输入完全一致；只附单价、行合计与总计。
 * 任一行缺单价 → 拒绝导出。导出只有六列，不含成本、毛利率、加成率、供应商名称。
 */
import { type DecimalInput } from "@/lib/project-finance/money";
import { toDecimalOrNull, validatePriceSchedule, type PriceScheduleLine, type ScheduleIssue } from "./contract";
import { priceSchedule } from "./unit-conversion";

export const OFFICIAL_EXPORT_COLUMNS = ["lineNo", "description", "uom", "quantity", "unitPrice", "extended"] as const;
export const OFFICIAL_EXPORT_TAX_NOTE = "不含 HST" as const;

export type OfficialExportRow = {
  lineNo: number;
  description: string;
  uom: string;
  quantity: string;
  unitPrice: string;
  extended: string;
};

export type OfficialExport =
  | { ok: true; rows: OfficialExportRow[]; total: string; taxNote: typeof OFFICIAL_EXPORT_TAX_NOTE; csv: string }
  | { ok: false; code: "SCHEDULE_INVALID"; issues: ScheduleIssue[]; messageZh: string }
  | { ok: false; code: "MISSING_UNIT_PRICE"; missingLineNos: number[]; messageZh: string };

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** unitPrices：行号 → 招标单位单价（已换算到招标单位）。 */
export function exportOfficialPriceSchedule(
  lines: readonly PriceScheduleLine[],
  unitPrices: Readonly<Record<number, DecimalInput | null | undefined>>,
): OfficialExport {
  const validation = validatePriceSchedule(lines);
  if (!validation.valid) {
    return { ok: false, code: "SCHEDULE_INVALID", issues: validation.issues, messageZh: "价格表行项结构有问题，不能导出" };
  }
  const missing = lines.filter((l) => {
    const p = toDecimalOrNull(unitPrices[l.lineNo]);
    return !p || p.isNegative();
  }).map((l) => l.lineNo);
  if (missing.length > 0) {
    return { ok: false, code: "MISSING_UNIT_PRICE", missingLineNos: missing, messageZh: `第 ${missing.join("、")} 行缺少单价，不能导出` };
  }
  const priced = priceSchedule(lines.map((l) => ({ lineNo: l.lineNo, quantity: l.quantity, unitPrice: unitPrices[l.lineNo] as DecimalInput })));
  const rows: OfficialExportRow[] = lines.map((l, i) => ({
    lineNo: l.lineNo,
    description: l.description,
    uom: l.uom,
    quantity: priced.lines[i].quantity.toString(),
    unitPrice: priced.lines[i].unitPrice.toFixed(2),
    extended: priced.lines[i].extended.toFixed(2),
  }));
  const total = priced.total.toFixed(2);
  const csv = [
    ["Line", "Description", "UOM", "Quantity", "Unit Price", "Extended Price"].join(","),
    ...rows.map((r) => OFFICIAL_EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(",")),
    ["", "Total (excluding HST)", "", "", "", total].join(","),
  ].join("\n");
  return { ok: true, rows, total, taxNote: OFFICIAL_EXPORT_TAX_NOTE, csv };
}
