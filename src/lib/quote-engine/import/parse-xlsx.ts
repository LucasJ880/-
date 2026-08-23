/**
 * XLSX / CSV 成本表确定性抽取（Phase 2.1：真实模版适配）
 *
 * 顺序：workbook structure inspection → header detection（中英同义词 + **上下文规则**）→ table extraction
 *       → heuristic mapping（类别 / 算法 / 币种）→（AI 仅在低置信度行上补充，见 classify-ai.ts）。
 * 纪律：
 *  - 金额 / 数量 / 单价只来自单元格本身；解析不出的数字标 UNPARSED_NUMBER，绝不猜。
 *  - 币种优先级（fail-closed）：行级币种列/符号 → 表头 (CAD) / 表级 "Currency: X" → 人工显式确认（confirmedCurrency）→ UNRESOLVED；绝不用报价币种兜底。
 *  - **表头「价格」上下文敏感**（P0-A）：`项目|价格`（无数量/单价/总价）→ 价格 = 金额；`项目|数量|价格`（无总价/单价）→ AMBIGUOUS_AMOUNT_COLUMN；
 *    显式 单价/总价/金额/Unit Price 永远压过「价格」。
 *  - **无表头回退 fail-closed**（P0-B）：先排除百分比格式单元，再按列一致性选金额列；选不出 → AMBIGUOUS_AMOUNT_COLUMN（挡 Confirm），绝不取"最后一个数字"。
 *  - **百分比单元**（P0-C）：Excel 百分比格式的数字不是金额；保留为 suggestedRate 提示；不自动生成 PERCENT_OF_*。
 *  - **对账守卫**（P0-D）：显式 Total/合计 行或末尾纯数字校验行 = 参考总计，不导入；与抽取合计比对 → RECONCILIATION_MISMATCH 提示。
 *  - **利润行**（P1）：识别为 PROFIT 的行默认不导入（PROFIT_PRICING_RULE_RECOMMENDED），provenance 完整保留，人工可重新勾选。
 */

import * as XLSX from "xlsx";
import { classifyDescription, extractRatePct, looksLikeTotalLine, normalizeDescription } from "./classify";
import { IMPORT_EXTRACTION_VERSION, LOW_CONFIDENCE_THRESHOLD, type ExtractionResult, type ImportRow, type ImportRowWarning, type ReconciliationResult, type SheetReconciliation } from "./contract";
import { reconcileTotals } from "./reconcile";

export type Cell = string | number | boolean | Date | null;
/** 带格式单元：pct = Excel 百分比数字格式（0.08 显示为 8%）或显示文本以 % 结尾 */
export type GridCell = { v: Cell; pct: boolean };
type ColumnRole = "description" | "quantity" | "unit" | "unitCost" | "amount" | "currency" | "category" | "notes" | "price";

/** 同义词按优先级排序：同一角色多列命中时取优先级最高者；「价格/报价/Price」为上下文敏感角色 price */
const HEADER_SYNONYMS: Array<{ role: ColumnRole; priority: number; patterns: RegExp[] }> = [
  { role: "description", priority: 3, patterns: [/descriptions?/i, /^描述$/, /^工作内容$/, /^费用项目$/] },
  { role: "description", priority: 2, patterns: [/^particulars$/i, /^scope/i, /^(work|product|service)s?$/i, /^(item\s*)?name$/i, /^项目(名称)?$/, /^名称$/, /^品名$/, /^内容$/, /^科目$/] },
  { role: "description", priority: 1, patterns: [/^items?$/i] },
  { role: "quantity", priority: 3, patterns: [/^q'?ty\.?$/i, /^quantity$/i, /^数量$/] },
  { role: "quantity", priority: 2, patterns: [/^pcs$/i, /^no\.?\s*of/i] },
  { role: "unit", priority: 3, patterns: [/^unit$/i, /^uom$/i, /^u\/m$/i, /^单位$/, /^计量单位$/] },
  { role: "unitCost", priority: 3, patterns: [/^unit\s*(cost|price|rate)/i, /^(cost|price)\s*(\/|per)\s*unit/i, /^单价/, /^单位成本/, /^单位价格/] },
  { role: "unitCost", priority: 2, patterns: [/^rate$/i, /^unit\s*\$?$/i] },
  { role: "amount", priority: 3, patterns: [/^(line\s*)?total(\s*(cost|price|amount))?$/i, /^amount$/i, /^ext(ended)?\.?(\s*(price|amount|cost))?$/i, /^金额/, /^合计$/, /^总价$/, /^总额$/, /^总金额$/] },
  { role: "amount", priority: 2, patterns: [/^(total\s*)?cost$/i, /^value$/i, /^subtotal$/i, /^成本$/, /^小计$/, /^费用$/] },
  { role: "price", priority: 1, patterns: [/^价格$/, /^报价$/, /^价格\s*[（(]\s*含税\s*[)）]$/, /^报价\s*[（(]\s*含税\s*[)）]$/, /^price$/i] },
  { role: "currency", priority: 3, patterns: [/^currency$/i, /^ccy$/i, /^cur\.?$/i, /^币种$/, /^货币$/] },
  { role: "category", priority: 3, patterns: [/^category$/i, /^type$/i, /^group$/i, /^class$/i, /^类别$/, /^分类$/, /^类型$/] },
  { role: "notes", priority: 3, patterns: [/^notes?$/i, /^remarks?$/i, /^comments?$/i, /^备注$/, /^说明$/] },
];

const CURRENCY_TOKENS: Array<{ re: RegExp; code: string }> = [
  { re: /\bCAD\b|C\$|CA\$/i, code: "CAD" },
  { re: /\bUSD\b|US\$/i, code: "USD" },
  { re: /\bCNY\b|\bRMB\b|人民币|￥|¥/i, code: "CNY" },
  { re: /\bEUR\b|€/i, code: "EUR" },
  { re: /\bGBP\b|£/i, code: "GBP" },
];

export function detectCurrencyToken(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const t of CURRENCY_TOKENS) if (t.re.test(text)) return t.code;
  return null;
}

export type NumberRead = { value: number | null; raw: string | null; isPercent: boolean; unparsed: boolean };

/** 解析单元格数字：支持 "$20,000.00" / "CAD 1,200" / "(500)" 负数 / "1.5%"（百分比 → isPercent，不当金额） */
export function parseNumberCell(v: Cell, pctFormat = false): NumberRead {
  if (v == null || v === "") return { value: null, raw: null, isPercent: false, unparsed: false };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { value: null, raw: String(v), isPercent: false, unparsed: true };
    return pctFormat ? { value: null, raw: `${Math.round(v * 10000) / 100}%`, isPercent: true, unparsed: false } : { value: v, raw: String(v), isPercent: false, unparsed: false };
  }
  if (typeof v === "boolean" || v instanceof Date) return { value: null, raw: String(v), isPercent: false, unparsed: true };
  const raw = String(v).trim();
  if (!raw) return { value: null, raw: null, isPercent: false, unparsed: false };
  if (/%\s*$/.test(raw)) return { value: null, raw, isPercent: true, unparsed: false };
  const neg = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const cleaned = raw.replace(/[()]/g, "").replace(/[A-Za-z$€£¥￥,\s]/g, "").replace(/^-/, "");
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return { value: null, raw, isPercent: false, unparsed: true };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, raw, isPercent: false, unparsed: true };
  return { value: neg ? -n : n, raw, isPercent: false, unparsed: false };
}

const NONE: NumberRead = { value: null, raw: null, isPercent: false, unparsed: false };
const readNum = (c: GridCell | undefined): NumberRead => (c ? parseNumberCell(c.v, c.pct) : NONE);
/** 百分比数值（0.08 → 8；文本 "8%" → 8） */
function percentOf(c: GridCell | undefined): number | null {
  if (!c || c.v == null) return null;
  if (typeof c.v === "number" && c.pct) return Math.round(c.v * 10000) / 100;
  if (typeof c.v === "string") return extractRatePct(c.v);
  return null;
}

function cellText(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
const textOf = (c: GridCell | undefined): string => (c ? cellText(c.v) : "");

/** 读取工作表为带格式网格（行索引 = Excel 行号 − 1；空行保留） */
export function readSheetGrid(ws: XLSX.WorkSheet): GridCell[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const grid: GridCell[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: GridCell[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null || cell.v === "") { row.push({ v: null, pct: false }); continue; }
      const pct = typeof cell.v === "number" && ((typeof cell.z === "string" && cell.z.includes("%")) || (typeof cell.w === "string" && /%\s*$/.test(cell.w)));
      row.push({ v: cell.t === "d" ? (cell.v as Date) : (cell.v as Cell), pct });
    }
    grid.push(row);
  }
  return grid;
}

function headerRole(text: string): { role: ColumnRole; priority: number } | null {
  const t = text.replace(/\s*\((CAD|USD|CNY|RMB|EUR|GBP|\$)\)\s*$/i, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  let best: { role: ColumnRole; priority: number } | null = null;
  for (const s of HEADER_SYNONYMS) {
    if (s.patterns.some((re) => re.test(t)) && (!best || s.priority > best.priority)) best = { role: s.role, priority: s.priority };
  }
  return best;
}

export type AmountMode = "explicit" | "price_as_amount" | "ambiguous_price" | "none";
export type HeaderMap = { rowIndex: number; columns: Map<number, ColumnRole>; currencyByColumn: Map<number, string>; amountMode: AmountMode; priceColumn: number | null };

/**
 * 表头检测（前 25 行）：≥2 个已知列 + 描述列 + （金额列 | 单价列 | 上下文可判的「价格」）。
 * 「价格」上下文规则：无数量/单价/总价 → 金额；有显式单价 → 总价；有数量但无单价/总价 → AMBIGUOUS（不猜）；有显式总价 → 忽略价格列。
 */
export function detectHeader(rows: Cell[][]): HeaderMap | null {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const best = new Map<ColumnRole, { idx: number; priority: number }>();
    const currencyByColumn = new Map<number, string>();
    row.forEach((c, idx) => {
      const text = cellText(c);
      const hit = headerRole(text);
      if (!hit) return;
      const cur = best.get(hit.role);
      if (!cur || hit.priority > cur.priority) best.set(hit.role, { idx, priority: hit.priority });
      const ccy = detectCurrencyToken(text);
      if (ccy) currencyByColumn.set(idx, ccy);
    });
    const columns = new Map<number, ColumnRole>();
    for (const [role, v] of best) if (role !== "price") columns.set(v.idx, role);
    const hasQty = best.has("quantity"), hasUnit = best.has("unitCost"), hasAmount = best.has("amount");
    const priceColumn = best.get("price")?.idx ?? null;
    let amountMode: AmountMode = hasAmount ? "explicit" : "none";
    if (priceColumn != null) {
      if (hasAmount) { /* 显式总价/金额压过「价格」：价格列不映射 */ }
      else if (!hasQty && !hasUnit) { columns.set(priceColumn, "amount"); amountMode = "price_as_amount"; }
      else if (hasUnit) { columns.set(priceColumn, "amount"); amountMode = "price_as_amount"; }
      else { columns.set(priceColumn, "price"); amountMode = "ambiguous_price"; }
    }
    const roles = new Set(columns.values());
    if (roles.size >= 2 && roles.has("description") && (roles.has("amount") || roles.has("unitCost") || amountMode === "ambiguous_price")) {
      return { rowIndex: i, columns, currencyByColumn, amountMode, priceColumn };
    }
  }
  return null;
}

function sheetLevelCurrency(rows: GridCell[][], uptoRow: number): string | null {
  const limit = Math.min(rows.length, uptoRow + 1);
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i] ?? []) {
      const t = textOf(c);
      if (!t || t.length > 60) continue;
      if (/^(CAD|USD|CNY|RMB|EUR|GBP)$/i.test(t)) return detectCurrencyToken(t);
      const m = t.match(/(?:currency|prices?\s+in|币种|货币)\s*[:：]?\s*([A-Z]{3}|C\$|US\$|¥|￥)/i);
      if (m) return detectCurrencyToken(m[1]!);
    }
  }
  return null;
}

function guessSupplier(rows: GridCell[][], upto: number): string | null {
  const limit = Math.min(rows.length, Math.max(upto, 12));
  for (let i = 0; i < limit; i++) for (const c of rows[i] ?? []) {
    const t = textOf(c);
    const m = t.match(/^(?:supplier|vendor|from|seller|供应商|卖方)\s*[:：]\s*(.+)$/i);
    if (m && m[1]!.trim().length >= 2) return m[1]!.trim().slice(0, 120);
  }
  for (let i = 0; i < limit; i++) for (const c of rows[i] ?? []) {
    const t = textOf(c);
    if (!t || t.length > 80) continue;
    if (/\b(ltd|inc|llc|corp|co\.|limited|gmbh)\b|有限公司|株式会社/i.test(t) && !/summary|quotation|quote|cost|报价|汇总|估算/i.test(t)) return t.slice(0, 120);
  }
  return null;
}

function guessDate(rows: GridCell[][], upto: number): string | null {
  const limit = Math.min(rows.length, Math.max(upto, 12));
  for (let i = 0; i < limit; i++) for (const c of rows[i] ?? []) {
    if (c.v instanceof Date && !Number.isNaN(c.v.getTime())) return c.v.toISOString().slice(0, 10);
    const m = textOf(c).match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }
  return null;
}

type RowInput = {
  rowId: string; sheet: string; excelRow: number; cellRef: string | null; description: string; section: string | null; categoryText: string | null;
  quantity: number | null; unit: string | null; unitCost: number | null; amount: number | null; rawAmount: string | null; currency: string | null;
  unparsed: boolean; notes: string | null; snippet: string; rateSignal: number | null; ambiguousAmount: boolean;
};

function makeRow(input: RowInput): ImportRow {
  const warnings: ImportRowWarning[] = [];
  const cls = classifyDescription(input.description, { section: input.section, categoryText: input.categoryText });
  let quantity = input.quantity;
  let unitCost = input.unitCost;
  let amount = input.amount;
  if (amount == null && quantity != null && unitCost != null) amount = Math.round(quantity * unitCost * 100) / 100;
  if (unitCost == null && amount != null && quantity != null && quantity > 0) unitCost = Math.round((amount / quantity) * 10000) / 10000;
  if (amount != null && quantity != null && unitCost != null && quantity > 0 && Math.abs(quantity * unitCost - amount) > Math.max(1, Math.abs(amount) * 0.01)) warnings.push("QTY_PRICE_MISMATCH");
  const perUnit = quantity != null && quantity > 0 && unitCost != null && !warnings.includes("QTY_PRICE_MISMATCH");
  if (!perUnit) quantity = quantity != null && quantity > 0 ? quantity : null;
  if (input.ambiguousAmount) warnings.push("AMBIGUOUS_AMOUNT_COLUMN");
  else if (amount == null && unitCost == null) warnings.push("MISSING_AMOUNT");
  if ((amount ?? unitCost ?? 0) < 0) warnings.push("NEGATIVE_AMOUNT");
  if (!input.currency) warnings.push("MISSING_CURRENCY");
  if (input.unparsed) warnings.push("UNPARSED_NUMBER");
  if (cls.ambiguous || !cls.category) warnings.push("AMBIGUOUS_CATEGORY");
  let confidence = cls.confidence;
  if (warnings.includes("MISSING_AMOUNT") || warnings.includes("UNPARSED_NUMBER") || warnings.includes("AMBIGUOUS_AMOUNT_COLUMN")) confidence = Math.min(confidence, 0.3);
  if (confidence < LOW_CONFIDENCE_THRESHOLD) warnings.push("LOW_CONFIDENCE");
  // P1：利润不是成本——识别为 PROFIT 的行默认不导入（保留 provenance；人工可重新勾选）
  const isProfit = cls.category === "PROFIT";
  if (isProfit) warnings.push("PROFIT_PRICING_RULE_RECOMMENDED");
  const rate = input.rateSignal ?? extractRatePct(input.description);
  return {
    rowId: input.rowId,
    sourceDescription: input.description.slice(0, 300),
    suggestedDescription: normalizeDescription(input.description),
    quantity: perUnit ? quantity : null,
    unit: input.unit,
    unitCost: input.ambiguousAmount ? null : perUnit ? unitCost : (amount ?? unitCost),
    sourceAmount: input.ambiguousAmount ? null : amount,
    rawAmountText: input.rawAmount,
    sourceCurrency: input.currency,
    suggestedCategory: cls.category,
    suggestedCalculationType: perUnit ? "PER_UNIT" : "FIXED",
    suggestedCalculationBase: null,
    suggestedRate: rate,
    confidence,
    include: !warnings.includes("MISSING_AMOUNT") && !isProfit,
    userEdited: false,
    aiSuggested: false,
    warnings,
    evidence: { documentId: null, pageNumber: null, unitLabel: null, sheet: input.sheet, row: input.excelRow, cell: input.cellRef, snippet: input.snippet.slice(0, 300) },
    notes: input.notes,
  };
}

const rowSnippet = (row: GridCell[]): string => row.map((c) => (c.pct && typeof c.v === "number" ? `${Math.round(c.v * 10000) / 100}%` : textOf(c))).filter(Boolean).join(" | ");
const excelCol = (c: number) => XLSX.utils.encode_col(c);

export type SheetExtraction = { rows: ImportRow[]; notes: string[]; headerFound: boolean; currency: string | null; reconciliation: SheetReconciliation };

/** 工作表抽取（表头模式 + fail-closed 回退模式 + 对账） */
export function extractRowsFromSheet(sheetName: string, grid: GridCell[][], opts: { confirmedCurrency: string | null; rowIdPrefix: string }): SheetExtraction {
  const out: ImportRow[] = [];
  const notes: string[] = [];
  const values = grid.map((r) => r.map((c) => c.v));
  const header = detectHeader(values);
  let skippedTotals = 0;
  let lastDataRow = -1;
  let subtotalRef: { value: number; row: number } | null = null;
  let totalRef: { value: number; row: number } | null = null;
  let trailingRef: { value: number; row: number } | null = null;
  /** 显式参考总计：小计/Subtotal（税前成本口径）优先于 合计/Total；税行永不作参考 */
  const noteRef = (desc: string, value: number | null, row: number) => {
    if (value == null) return;
    if (/^(sub\s*-?\s*total|小计)/i.test(desc)) subtotalRef = { value, row };
    else if (/^(grand\s*total|total|合计|总计|总额)/i.test(desc)) totalRef = { value, row };
  };

  const finish = (currency: string | null, headerFound: boolean): SheetExtraction => {
    if (skippedTotals > 0) notes.push(`Sheet「${sheetName}」跳过合计/小计/税/校验行 ${skippedTotals} 条（不导入）`);
    const explicitRef = subtotalRef ?? totalRef;
    const ref = explicitRef ?? (trailingRef && trailingRef.row > lastDataRow ? trailingRef : null);
    const extractedTotal = out.reduce((s, r) => s + (r.sourceAmount ?? 0), 0);
    const rec = reconcileTotals({ referenceTotal: ref?.value ?? null, extractedTotal });
    const reconciliation: SheetReconciliation = { sheet: sheetName, referenceTotal: rec.referenceTotal, referenceSource: ref ? (explicitRef ? "explicit_total" : "numeric_only_row") : null, referenceRow: ref ? ref.row + 1 : null, extractedTotal: rec.extractedTotal, difference: rec.difference, tolerance: rec.tolerance, status: rec.status };
    if (rec.status === "MISMATCH") notes.push(`RECONCILIATION_MISMATCH：Sheet「${sheetName}」抽取合计 ${rec.extractedTotal.toLocaleString("en-CA")} 与工作簿参考总计 ${rec.referenceTotal!.toLocaleString("en-CA")}（第 ${ref!.row + 1} 行）相差 ${rec.difference!.toLocaleString("en-CA")}（容差 ${rec.tolerance!.toFixed(2)}）——请逐行核对金额`);
    return { rows: out, notes, headerFound, currency, reconciliation };
  };

  if (header) {
    const roleCol = new Map<ColumnRole, number>();
    for (const [idx, role] of header.columns) roleCol.set(role, idx);
    const mapped = new Set(header.columns.keys());
    const descCol = roleCol.get("description")!;
    const amountCol = roleCol.get("amount");
    const unitCostCol = roleCol.get("unitCost");
    const qtyCol = roleCol.get("quantity");
    const priceCol = header.amountMode === "ambiguous_price" ? header.priceColumn : null;
    const sheetCcy = sheetLevelCurrency(grid, header.rowIndex) ?? (amountCol != null ? header.currencyByColumn.get(amountCol) : undefined) ?? (unitCostCol != null ? header.currencyByColumn.get(unitCostCol) : undefined) ?? null;
    if (header.amountMode === "ambiguous_price") notes.push(`Sheet「${sheetName}」表头「${excelCol(header.priceColumn!)} 列 价格/报价」与数量列并存但无 单价/总价：无法判定是单价还是总价，全部行标 AMBIGUOUS_AMOUNT_COLUMN，需人工填写金额`);
    let section: string | null = null;
    for (let i = header.rowIndex + 1; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const desc = textOf(row[descCol]);
      const amountCell = amountCol != null ? readNum(row[amountCol]) : NONE;
      const unitCostCell = unitCostCol != null ? readNum(row[unitCostCol]) : NONE;
      const qtyCell = qtyCol != null ? readNum(row[qtyCol]) : NONE;
      const priceCell = priceCol != null ? readNum(row[priceCol]) : NONE;
      const hasMoney = amountCell.value != null || unitCostCell.value != null || priceCell.value != null;
      const hasPct = row.some((c) => percentOf(c) != null);
      if (!desc && !hasMoney) continue;
      if (!desc && hasMoney) { trailingRef = { value: amountCell.value ?? unitCostCell.value ?? priceCell.value!, row: i }; skippedTotals += 1; continue; }
      if (looksLikeTotalLine(desc)) { if (hasMoney) noteRef(desc, amountCell.value ?? unitCostCell.value ?? priceCell.value!, i); skippedTotals += 1; continue; }
      // 只有描述、无金额、无数量、无百分比 → 分组标题；带百分比的行是数据行（MISSING_AMOUNT + rate 提示，绝不把 0.08 当金额）
      if (desc && !hasMoney && qtyCell.value == null && !hasPct) { section = desc.slice(0, 80); continue; }
      // 未映射单元：百分比 → rate 提示；文本 → 备注；裸数字 → 仅作参考（绝不当金额）
      let rateSignal: number | null = null;
      const extra: string[] = [];
      const refNums: string[] = [];
      row.forEach((c, idx) => {
        if (mapped.has(idx) || c.v == null) return;
        const p = percentOf(c);
        if (p != null) { if (rateSignal == null) rateSignal = p; extra.push(`${p}%`); return; }
        if (typeof c.v === "number") { refNums.push(`${excelCol(idx)}${i + 1}=${c.v}`); return; }
        const t = textOf(c);
        if (t) extra.push(t);
      });
      if (amountCell.isPercent && rateSignal == null) rateSignal = percentOf(row[amountCol!]);
      const rowCcy = (roleCol.has("currency") ? detectCurrencyToken(textOf(row[roleCol.get("currency")!])) : null) ?? detectCurrencyToken(amountCell.raw) ?? detectCurrencyToken(unitCostCell.raw) ?? sheetCcy ?? opts.confirmedCurrency;
      const unit = roleCol.has("unit") ? textOf(row[roleCol.get("unit")!]).slice(0, 30) || null : null;
      const categoryText = roleCol.has("category") ? textOf(row[roleCol.get("category")!]) || null : null;
      const noteText = [roleCol.has("notes") ? textOf(row[roleCol.get("notes")!]) : "", ...extra, ...(refNums.length ? [`参考数值（未作金额）：${refNums.join(", ")}`] : [])].filter(Boolean).join("；").slice(0, 500) || null;
      const ambiguous = priceCol != null;
      const valueCol = amountCol ?? unitCostCol ?? priceCol ?? descCol;
      out.push(makeRow({
        rowId: `${opts.rowIdPrefix}r${i + 1}`, sheet: sheetName, excelRow: i + 1, cellRef: `${excelCol(valueCol)}${i + 1}`, description: desc, section, categoryText,
        quantity: qtyCell.value, unit, unitCost: unitCostCell.isPercent ? null : unitCostCell.value, amount: amountCell.isPercent ? null : amountCell.value, rawAmount: ambiguous ? priceCell.raw : (amountCell.raw ?? unitCostCell.raw), currency: rowCcy,
        unparsed: amountCell.unparsed || unitCostCell.unparsed || qtyCell.unparsed, notes: ambiguous ? [`「价格」列值 ${priceCell.raw ?? "—"}：可能是单价或总价，请人工确认后填写金额`, noteText].filter(Boolean).join("；") : noteText, snippet: rowSnippet(row), rateSignal, ambiguousAmount: ambiguous,
      }));
      lastDataRow = i;
    }
    return finish(sheetCcy, true);
  }

  /* ── 无表头回退（fail-closed）：先找数据行，再按列一致性选金额列；选不出 → AMBIGUOUS_AMOUNT_COLUMN ── */
  const sheetCcy = sheetLevelCurrency(grid, Math.min(grid.length, 12)) ?? opts.confirmedCurrency;
  type DataRow = { i: number; descIdx: number; desc: string; nums: Array<{ idx: number; n: NumberRead }> };
  const dataRows: DataRow[] = [];
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] ?? [];
    let descIdx = -1;
    let desc = "";
    const nums: Array<{ idx: number; n: NumberRead }> = [];
    row.forEach((c, idx) => {
      const n = readNum(c);
      if (n.value != null && !n.isPercent) nums.push({ idx, n });
      else if (descIdx < 0 && typeof c.v === "string" && textOf(c) && n.value == null && !n.isPercent && !/^(CAD|USD|CNY|RMB|EUR|GBP)$/i.test(textOf(c))) { descIdx = idx; desc = textOf(c); }
    });
    if (!desc && nums.length > 0) { trailingRef = { value: nums[nums.length - 1]!.n.value!, row: i }; skippedTotals += 1; continue; }
    if (!desc) continue;
    if (looksLikeTotalLine(desc)) { if (nums.length) noteRef(desc, nums[nums.length - 1]!.n.value!, i); skippedTotals += 1; continue; }
    const hasPct = row.some((c) => percentOf(c) != null);
    if (nums.length === 0 && !hasPct) continue;
    dataRows.push({ i, descIdx, desc, nums });
  }
  // 列一致性只在「带数值的行」上统计（只有百分比的行不稀释覆盖率）
  const colCount = new Map<number, number>();
  const rowsWithNumbers = dataRows.filter((d) => d.nums.length > 0).length;
  for (const d of dataRows) for (const { idx } of d.nums) colCount.set(idx, (colCount.get(idx) ?? 0) + 1);
  const candidates = [...colCount.entries()].filter(([, n]) => n / Math.max(1, rowsWithNumbers) >= 0.6).map(([idx]) => idx).sort((a, b) => a - b);
  let mode: "single" | "qty_unit_total" | "ambiguous" = "ambiguous";
  let amountCol: number | null = null, qtyColF: number | null = null, unitColF: number | null = null;
  if (candidates.length === 1) { mode = "single"; amountCol = candidates[0]!; }
  else if (candidates.length >= 3) {
    const [a, b, c] = candidates.slice(-3) as [number, number, number];
    let ok = 0, all = 0;
    for (const d of dataRows) {
      const va = d.nums.find((x) => x.idx === a)?.n.value, vb = d.nums.find((x) => x.idx === b)?.n.value, vc = d.nums.find((x) => x.idx === c)?.n.value;
      if (va == null || vb == null || vc == null) continue;
      all += 1;
      if (Math.abs(va * vb - vc) <= Math.max(1, Math.abs(vc) * 0.01)) ok += 1;
    }
    if (all > 0 && ok / all >= 0.8) { mode = "qty_unit_total"; qtyColF = a; unitColF = b; amountCol = c; }
  }
  notes.push(mode === "ambiguous"
    ? `Sheet「${sheetName}」未识别表头，且数值列结构不一致（候选列：${candidates.map(excelCol).join("、") || "无"}）——金额列无法确定，相关行标 AMBIGUOUS_AMOUNT_COLUMN，需人工填写金额`
    : `Sheet「${sheetName}」未识别表头，按列一致性选定金额列 ${excelCol(amountCol!)}${mode === "qty_unit_total" ? `（数量 ${excelCol(qtyColF!)} × 单价 ${excelCol(unitColF!)} ≈ 总价）` : ""}；其它数字仅作参考`);
  for (const d of dataRows) {
    const row = grid[d.i] ?? [];
    let rateSignal: number | null = null;
    const extra: string[] = [];
    row.forEach((c, idx) => { if (idx === d.descIdx || c.v == null) return; const p = percentOf(c); if (p != null) { if (rateSignal == null) rateSignal = p; extra.push(`${p}%`); } else if (typeof c.v === "string" && textOf(c)) extra.push(textOf(c)); });
    const pick = (col: number | null) => (col == null ? NONE : d.nums.find((x) => x.idx === col)?.n ?? NONE);
    const amountN = pick(amountCol);
    const others = d.nums.filter((x) => x.idx !== amountCol && x.idx !== qtyColF && x.idx !== unitColF).map((x) => `${excelCol(x.idx)}${d.i + 1}=${x.n.value}`);
    // 无任何数值（只有百分比）→ MISSING_AMOUNT（不是 ambiguous）；有数值但选不出列 → AMBIGUOUS
    const rowAmbiguous = d.nums.length > 0 && (mode === "ambiguous" || (amountN.value == null && mode === "single"));
    const candidateNote = rowAmbiguous ? `候选金额（未选定）：${d.nums.map((x) => `${excelCol(x.idx)}${d.i + 1}=${x.n.value}`).join(", ")}` : others.length ? `参考数值（未作金额）：${others.join(", ")}` : "";
    const rowCcy = detectCurrencyToken(amountN.raw) ?? sheetCcy;
    out.push(makeRow({
      rowId: `${opts.rowIdPrefix}r${d.i + 1}`, sheet: sheetName, excelRow: d.i + 1, cellRef: amountCol != null && !rowAmbiguous ? `${excelCol(amountCol)}${d.i + 1}` : null, description: d.desc, section: null, categoryText: null,
      quantity: pick(qtyColF).value, unit: null, unitCost: pick(unitColF).value, amount: rowAmbiguous ? null : amountN.value, rawAmount: rowAmbiguous ? null : amountN.raw, currency: rowAmbiguous ? sheetCcy : rowCcy,
      unparsed: false, notes: [...extra, candidateNote].filter(Boolean).join("；").slice(0, 500) || null, snippet: rowSnippet(row), rateSignal, ambiguousAmount: rowAmbiguous,
    }));
    lastDataRow = d.i;
  }
  return finish(sheetCcy, false);
}

export function extractRowsFromWorkbook(buffer: Buffer, opts: { confirmedCurrency?: string | null; sourceType?: "XLSX" | "CSV" } = {}): ExtractionResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: true });
  const rows: ImportRow[] = [];
  const notes: string[] = [];
  const sheets: string[] = [];
  const sheetRecs: SheetReconciliation[] = [];
  let detectedCurrency: string | null = null;
  let supplierNameGuess: string | null = null;
  let quoteDateGuess: string | null = null;
  workbook.SheetNames.forEach((name, si) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const grid = readSheetGrid(sheet);
    if (grid.length === 0) return;
    sheets.push(name);
    const res = extractRowsFromSheet(name, grid, { confirmedCurrency: opts.confirmedCurrency ?? null, rowIdPrefix: `s${si + 1}` });
    rows.push(...res.rows);
    notes.push(...res.notes);
    sheetRecs.push(res.reconciliation);
    if (!detectedCurrency && res.currency && res.currency !== opts.confirmedCurrency) detectedCurrency = res.currency;
    if (!supplierNameGuess) supplierNameGuess = guessSupplier(grid, 12);
    if (!quoteDateGuess) quoteDateGuess = guessDate(grid, 12);
  });
  if (rows.length === 0) notes.push("未抽取到任何成本行（请检查表头：描述 + 金额/单价 列）");
  const withRef = sheetRecs.filter((s) => s.referenceTotal != null);
  const overall = withRef.length > 0
    ? reconcileTotals({ referenceTotal: withRef.reduce((s, r) => s + (r.referenceTotal ?? 0), 0), extractedTotal: withRef.reduce((s, r) => s + r.extractedTotal, 0) })
    : reconcileTotals({ referenceTotal: null, extractedTotal: rows.reduce((s, r) => s + (r.sourceAmount ?? 0), 0) });
  const reconciliation: ReconciliationResult = { status: withRef.some((s) => s.status === "MISMATCH") ? "MISMATCH" : overall.status, referenceTotal: overall.referenceTotal, extractedTotal: Math.round(rows.reduce((s, r) => s + (r.sourceAmount ?? 0), 0) * 100) / 100, difference: overall.difference, tolerance: overall.tolerance, sheets: sheetRecs };
  return { extractionVersion: IMPORT_EXTRACTION_VERSION, sourceType: opts.sourceType ?? "XLSX", rows: rows.slice(0, 500), sheets, pages: null, detectedCurrency, supplierNameGuess, quoteDateGuess, notes, reconciliation };
}
