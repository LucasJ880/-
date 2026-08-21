/**
 * XLSX / CSV 成本表确定性抽取（不依赖固定列位置）。
 *
 * 顺序：workbook structure inspection → header detection（中英同义词）→ table extraction
 *       → heuristic mapping（类别 / 算法 / 币种）→（AI 仅在低置信度行上补充，见 classify-ai.ts）。
 * 金额 / 数量 / 单价只来自单元格本身；解析不出的数字标 UNPARSED_NUMBER，绝不猜。
 */

import * as XLSX from "xlsx";
import { classifyDescription, extractRatePct, looksLikeTotalLine, normalizeDescription } from "./classify";
import { IMPORT_EXTRACTION_VERSION, LOW_CONFIDENCE_THRESHOLD, type ExtractionResult, type ImportRow, type ImportRowWarning } from "./contract";

type Cell = string | number | boolean | Date | null;
type ColumnRole = "description" | "quantity" | "unit" | "unitCost" | "amount" | "currency" | "category" | "notes";

/** 同义词按优先级排序：同一角色多列命中时取优先级最高者（"Description" 胜 "Item"；"Unit Cost" 胜 "Price"） */
const HEADER_SYNONYMS: Array<{ role: ColumnRole; priority: number; patterns: RegExp[] }> = [
  { role: "description", priority: 3, patterns: [/descriptions?/i, /^描述$/, /^工作内容$/, /^费用项目$/] },
  { role: "description", priority: 2, patterns: [/^particulars$/i, /^scope/i, /^(work|product|service)s?$/i, /^(item\s*)?name$/i, /^项目(名称)?$/, /^名称$/, /^品名$/, /^内容$/] },
  { role: "description", priority: 1, patterns: [/^items?$/i] },
  { role: "quantity", priority: 3, patterns: [/^q'?ty\.?$/i, /^quantity$/i, /^数量$/] },
  { role: "quantity", priority: 2, patterns: [/^pcs$/i, /^no\.?\s*of/i] },
  { role: "unit", priority: 3, patterns: [/^unit$/i, /^uom$/i, /^u\/m$/i, /^单位$/, /^计量单位$/] },
  { role: "unitCost", priority: 3, patterns: [/^unit\s*(cost|price|rate)/i, /^(cost|price)\s*(\/|per)\s*unit/i, /^单价/, /^单位成本/, /^单位价格/] },
  { role: "unitCost", priority: 2, patterns: [/^rate$/i, /^price$/i, /^unit\s*\$?$/i] },
  { role: "amount", priority: 3, patterns: [/^(line\s*)?total(\s*(cost|price|amount))?$/i, /^amount$/i, /^ext(ended)?\.?(\s*(price|amount|cost))?$/i, /^金额$/, /^合计$/, /^总价$/, /^总额$/] },
  { role: "amount", priority: 2, patterns: [/^(total\s*)?cost$/i, /^value$/i, /^subtotal$/i, /^成本$/, /^小计$/, /^费用$/] },
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

/** 解析单元格数字：支持 "$20,000.00" / "CAD 1,200" / "(500)" 负数 / "1.5%"（百分比返回 null 交给 rate 提示） */
export function parseNumberCell(v: Cell): { value: number | null; raw: string | null; isPercent: boolean; unparsed: boolean } {
  if (v == null || v === "") return { value: null, raw: null, isPercent: false, unparsed: false };
  if (typeof v === "number") return { value: Number.isFinite(v) ? v : null, raw: String(v), isPercent: false, unparsed: !Number.isFinite(v) };
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

function cellText(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
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

type HeaderMap = { rowIndex: number; columns: Map<number, ColumnRole>; currencyByColumn: Map<number, string> };

/** 表头检测：前 25 行里找「≥2 个已知列 + 含描述列 + 含数值列」的行 */
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
    for (const [role, v] of best) columns.set(v.idx, role);
    const roles = new Set(columns.values());
    if (roles.size >= 2 && roles.has("description") && (roles.has("amount") || roles.has("unitCost"))) {
      return { rowIndex: i, columns, currencyByColumn };
    }
  }
  return null;
}

function sheetLevelCurrency(rows: Cell[][], headerRowIndex: number): string | null {
  const limit = Math.min(rows.length, headerRowIndex + 1);
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i] ?? []) {
      const t = cellText(c);
      if (!t || t.length > 60) continue;
      if (/^(CAD|USD|CNY|RMB|EUR|GBP)$/i.test(t)) return detectCurrencyToken(t);
      const m = t.match(/(?:currency|prices?\s+in|币种|货币)\s*[:：]?\s*([A-Z]{3}|C\$|US\$|¥|￥)/i);
      if (m) return detectCurrencyToken(m[1]!);
    }
  }
  return null;
}

function guessSupplier(rows: Cell[][], headerRowIndex: number): string | null {
  const limit = Math.min(rows.length, Math.max(headerRowIndex, 12));
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i] ?? []) {
      const t = cellText(c);
      const m = t.match(/^(?:supplier|vendor|from|seller|供应商|卖方)\s*[:：]\s*(.+)$/i);
      if (m && m[1]!.trim().length >= 2) return m[1]!.trim().slice(0, 120);
    }
  }
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i] ?? []) {
      const t = cellText(c);
      if (!t || t.length > 80) continue;
      if (/\b(ltd|inc|llc|corp|co\.|limited|gmbh)\b|有限公司|株式会社/i.test(t) && !/summary|quotation|quote|cost|报价|汇总|估算/i.test(t)) return t.slice(0, 120);
    }
  }
  return null;
}

function guessDate(rows: Cell[][], headerRowIndex: number): string | null {
  const limit = Math.min(rows.length, Math.max(headerRowIndex, 12));
  for (let i = 0; i < limit; i++) {
    for (const c of rows[i] ?? []) {
      if (c instanceof Date && !Number.isNaN(c.getTime())) return c.toISOString().slice(0, 10);
      const t = cellText(c);
      const m = t.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
    }
  }
  return null;
}

function makeRow(input: {
  rowId: string; sheet: string; excelRow: number; cellRef: string | null; description: string; section: string | null; categoryText: string | null;
  quantity: number | null; unit: string | null; unitCost: number | null; amount: number | null; rawAmount: string | null; currency: string | null;
  unparsed: boolean; notes: string | null; snippet: string;
}): ImportRow {
  const warnings: ImportRowWarning[] = [];
  const cls = classifyDescription(input.description, { section: input.section, categoryText: input.categoryText });
  let quantity = input.quantity;
  let unitCost = input.unitCost;
  let amount = input.amount;
  // 数量 × 单价 与 金额 的互补/核对
  if (amount == null && quantity != null && unitCost != null) amount = Math.round(quantity * unitCost * 100) / 100;
  if (unitCost == null && amount != null && quantity != null && quantity > 0) unitCost = Math.round((amount / quantity) * 10000) / 10000;
  if (amount != null && quantity != null && unitCost != null && quantity > 0 && Math.abs(quantity * unitCost - amount) > Math.max(1, Math.abs(amount) * 0.01)) warnings.push("QTY_PRICE_MISMATCH");
  const perUnit = quantity != null && quantity > 0 && unitCost != null && !warnings.includes("QTY_PRICE_MISMATCH");
  if (!perUnit) quantity = quantity != null && quantity > 0 ? quantity : null;
  if (amount == null && unitCost == null) warnings.push("MISSING_AMOUNT");
  if ((amount ?? unitCost ?? 0) < 0) warnings.push("NEGATIVE_AMOUNT");
  if (!input.currency) warnings.push("MISSING_CURRENCY");
  if (input.unparsed) warnings.push("UNPARSED_NUMBER");
  if (cls.ambiguous || !cls.category) warnings.push("AMBIGUOUS_CATEGORY");
  let confidence = cls.confidence;
  if (warnings.includes("MISSING_AMOUNT") || warnings.includes("UNPARSED_NUMBER")) confidence = Math.min(confidence, 0.3);
  if (confidence < LOW_CONFIDENCE_THRESHOLD) warnings.push("LOW_CONFIDENCE");
  const rate = extractRatePct(input.description);
  return {
    rowId: input.rowId,
    sourceDescription: input.description.slice(0, 300),
    suggestedDescription: normalizeDescription(input.description),
    quantity: perUnit ? quantity : null,
    unit: input.unit,
    unitCost: perUnit ? unitCost : (amount ?? unitCost),
    sourceAmount: amount,
    rawAmountText: input.rawAmount,
    sourceCurrency: input.currency,
    suggestedCategory: cls.category,
    suggestedCalculationType: perUnit ? "PER_UNIT" : "FIXED",
    suggestedCalculationBase: null,
    suggestedRate: rate,
    confidence,
    include: !warnings.includes("MISSING_AMOUNT"),
    userEdited: false,
    aiSuggested: false,
    warnings,
    evidence: { documentId: null, pageNumber: null, unitLabel: null, sheet: input.sheet, row: input.excelRow, cell: input.cellRef, snippet: input.snippet.slice(0, 300) },
    notes: input.notes,
  };
}

function rowSnippet(row: Cell[]): string {
  return row.map(cellText).filter(Boolean).join(" | ");
}

/** 工作表抽取（含无表头回退：描述 + 行内最后一个数字） */
export function extractRowsFromSheet(sheetName: string, rows: Cell[][], opts: { defaultCurrency: string | null; rowIdPrefix: string }): { rows: ImportRow[]; notes: string[]; headerFound: boolean; currency: string | null } {
  const out: ImportRow[] = [];
  const notes: string[] = [];
  const header = detectHeader(rows);
  let skippedTotals = 0;
  if (header) {
    const roleCol = new Map<ColumnRole, number>();
    for (const [idx, role] of header.columns) roleCol.set(role, idx);
    const sheetCcy = sheetLevelCurrency(rows, header.rowIndex) ?? header.currencyByColumn.get(roleCol.get("amount") ?? -1) ?? header.currencyByColumn.get(roleCol.get("unitCost") ?? -1) ?? null;
    let section: string | null = null;
    for (let i = header.rowIndex + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const desc = cellText(row[roleCol.get("description")!] ?? null);
      const amountCell = roleCol.has("amount") ? parseNumberCell(row[roleCol.get("amount")!] ?? null) : { value: null, raw: null, isPercent: false, unparsed: false };
      const unitCostCell = roleCol.has("unitCost") ? parseNumberCell(row[roleCol.get("unitCost")!] ?? null) : { value: null, raw: null, isPercent: false, unparsed: false };
      const qtyCell = roleCol.has("quantity") ? parseNumberCell(row[roleCol.get("quantity")!] ?? null) : { value: null, raw: null, isPercent: false, unparsed: false };
      const hasNumber = amountCell.value != null || unitCostCell.value != null;
      if (!desc && !hasNumber) continue;
      if (!desc && hasNumber) { skippedTotals += 1; continue; }
      if (looksLikeTotalLine(desc)) { skippedTotals += 1; continue; }
      if (desc && !hasNumber && qtyCell.value == null) { section = desc.slice(0, 80); continue; }
      const rowCcy = (roleCol.has("currency") ? detectCurrencyToken(cellText(row[roleCol.get("currency")!] ?? null)) : null) ?? detectCurrencyToken(amountCell.raw) ?? detectCurrencyToken(unitCostCell.raw) ?? sheetCcy ?? opts.defaultCurrency;
      const unit = roleCol.has("unit") ? cellText(row[roleCol.get("unit")!] ?? null).slice(0, 30) || null : null;
      const categoryText = roleCol.has("category") ? cellText(row[roleCol.get("category")!] ?? null) || null : null;
      const noteText = roleCol.has("notes") ? cellText(row[roleCol.get("notes")!] ?? null) || null : null;
      const amountCol = roleCol.get("amount") ?? roleCol.get("unitCost") ?? 0;
      out.push(makeRow({
        rowId: `${opts.rowIdPrefix}r${i + 1}`, sheet: sheetName, excelRow: i + 1, cellRef: XLSX.utils.encode_cell({ r: i, c: amountCol }), description: desc, section, categoryText,
        quantity: qtyCell.value, unit, unitCost: unitCostCell.value, amount: amountCell.value, rawAmount: amountCell.raw ?? unitCostCell.raw, currency: rowCcy,
        unparsed: amountCell.unparsed || unitCostCell.unparsed || qtyCell.unparsed, notes: noteText, snippet: rowSnippet(row),
      }));
    }
    if (skippedTotals > 0) notes.push(`Sheet「${sheetName}」跳过合计/小计/税行 ${skippedTotals} 条`);
    return { rows: out, notes, headerFound: true, currency: sheetCcy };
  }
  // 无表头回退：每行「第一个文本 + 最后一个数字」
  const sheetCcy = sheetLevelCurrency(rows, Math.min(rows.length, 12)) ?? opts.defaultCurrency;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const texts = row.map((c, idx) => ({ idx, t: cellText(c), n: parseNumberCell(c) }));
    const desc = texts.find((x) => x.t && x.n.value == null && !x.n.isPercent)?.t ?? "";
    const nums = texts.filter((x) => x.n.value != null);
    if (!desc || nums.length === 0) continue;
    if (looksLikeTotalLine(desc)) { skippedTotals += 1; continue; }
    const last = nums[nums.length - 1]!;
    const qty = nums.length >= 3 ? nums[0]!.n.value : null;
    const unitCost = nums.length >= 3 ? nums[1]!.n.value : null;
    out.push(makeRow({
      rowId: `${opts.rowIdPrefix}r${i + 1}`, sheet: sheetName, excelRow: i + 1, cellRef: XLSX.utils.encode_cell({ r: i, c: last.idx }), description: desc, section: null, categoryText: null,
      quantity: qty, unit: null, unitCost, amount: last.n.value, rawAmount: last.n.raw, currency: detectCurrencyToken(last.n.raw) ?? sheetCcy,
      unparsed: false, notes: null, snippet: rowSnippet(row),
    }));
  }
  notes.push(`Sheet「${sheetName}」未识别表头，按「描述 + 行内最后一个数字」回退抽取`);
  if (skippedTotals > 0) notes.push(`Sheet「${sheetName}」跳过合计/小计/税行 ${skippedTotals} 条`);
  return { rows: out, notes, headerFound: false, currency: sheetCcy };
}

export function extractRowsFromWorkbook(buffer: Buffer, opts: { defaultCurrency?: string | null; sourceType?: "XLSX" | "CSV" } = {}): ExtractionResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const rows: ImportRow[] = [];
  const notes: string[] = [];
  const sheets: string[] = [];
  let detectedCurrency: string | null = null;
  let supplierNameGuess: string | null = null;
  let quoteDateGuess: string | null = null;
  workbook.SheetNames.forEach((name, si) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true }) as Cell[][];
    if (grid.length === 0) return;
    sheets.push(name);
    const res = extractRowsFromSheet(name, grid, { defaultCurrency: opts.defaultCurrency ?? null, rowIdPrefix: `s${si + 1}` });
    rows.push(...res.rows);
    notes.push(...res.notes);
    if (!detectedCurrency && res.currency) detectedCurrency = res.currency;
    if (!supplierNameGuess) supplierNameGuess = guessSupplier(grid, 12);
    if (!quoteDateGuess) quoteDateGuess = guessDate(grid, 12);
  });
  if (rows.length === 0) notes.push("未抽取到任何成本行（请检查表头：描述 + 金额/单价 列）");
  return { extractionVersion: IMPORT_EXTRACTION_VERSION, sourceType: opts.sourceType ?? "XLSX", rows: rows.slice(0, 500), sheets, pages: null, detectedCurrency, supplierNameGuess, quoteDateGuess, notes };
}
