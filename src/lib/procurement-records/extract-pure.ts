/**
 * PROC-1 披露文件明细抽取（纯函数，design D10）：确定性、可追溯、默认待复核。
 *
 * - 表格（CSV / XLSX 工作表）：表头同义词（英 / 法）映射列；金额口径由表头或工作表名判定，判定不了为 UNKNOWN；
 * - 可读 PDF：抽含金额的文本行为候选，口径 UNKNOWN；
 * - 缺失值为 null，不补 0；无法无歧义解析的日期（如 8/14/23）为 null，原文保留在片段里；
 * - 文件内容只当数据：任何「忽略规则 / 改收件人 / 发送」之类文字不会被解释或执行。
 */

import { foldText, normalizeInstrumentNumber } from "./identity";
import { parseCsv } from "./sources-pure";

export const AMOUNT_BASES = ["CEILING", "EVALUATED", "COMMITTED", "ORDERED", "INVOICED", "PAID", "UNKNOWN"] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];
export const AMOUNT_BASIS_LABELS: Record<AmountBasis, string> = {
  CEILING: "上限 / 框架值（ceiling）",
  EVALUATED: "评估价（evaluated）",
  COMMITTED: "承诺（committed）",
  ORDERED: "订单（ordered）",
  INVOICED: "发票（invoiced）",
  PAID: "已付（paid）",
  UNKNOWN: "口径未识别",
};

export const DOCUMENT_TYPES = ["CONTRACT", "AMENDMENT", "CALL_UP", "PURCHASE_ORDER", "INVOICE", "PAYMENT", "USAGE_REPORT", "PRICE_SCHEDULE", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ExtractedLine {
  dedupeKey: string;
  instrumentNumber: string | null;
  documentType: DocumentType;
  amountBasis: AmountBasis;
  amendmentMode: "INCREMENT" | "REVISED_TOTAL" | "UNKNOWN" | null;
  docRef: string | null;
  linkedRef: string | null;
  docDate: string | null;
  productDescription: string | null;
  specification: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  amount: string | null;
  currency: string | null;
  deliveryLocation: string | null;
  taxFreightNote: string | null;
  isCancellationOrCredit: boolean;
  sourceUnitIndex: number;
  sourcePage: number | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  rawSnippet: string;
  extractionMethod: "TABLE_COLUMN_MAP" | "PDF_TEXT_LINE";
}

// ─────────────────────────── 数值与日期 ───────────────────────────

/** 金额 / 数量文本 → 规范十进制字符串；括号或 CR 为负；法式小数逗号；无法解析 → null */
export function parseDecimal(raw: string | null | undefined): { value: string | null; negative: boolean } {
  if (raw === null || raw === undefined) return { value: null, negative: false };
  let s = String(raw).trim();
  if (!s) return { value: null, negative: false };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bCR\b$/i.test(s)) {
    negative = true;
    s = s.replace(/\bCR\b$/i, "");
  }
  s = s.replace(/(CAD|USD|EUR|\$|€|£)/gi, "").replace(/ /g, " ").trim();
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (/^\d{1,3}( \d{3})+(,\d+)?$/.test(s) || /^\d+,\d{1,4}$/.test(s)) s = s.replace(/ /g, "").replace(",", ".");
  else s = s.replace(/[, ]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, negative: false };
  const v = s.replace(/^0+(?=\d)/, "");
  return { value: negative && Number(v) !== 0 ? `-${v}` : v, negative };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, janv: 1, fev: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, déc: 12 };

function isoOf(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** 只解析无歧义的日期格式；8/14/23 之类 m/d 不确定的格式 → null */
export function parseUnambiguousDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[- ]([A-Za-zéû]{3,5})\.?[- ,]+(\d{4})$/.exec(s);
  if (m && MONTHS[foldText(m[2]).slice(0, 4)] !== undefined) return isoOf(+m[3], MONTHS[foldText(m[2]).slice(0, 4)] ?? MONTHS[foldText(m[2]).slice(0, 3)], +m[1]);
  if (m && MONTHS[foldText(m[2]).slice(0, 3)] !== undefined) return isoOf(+m[3], MONTHS[foldText(m[2]).slice(0, 3)], +m[1]);
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)] !== undefined) return isoOf(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]);
  return null;
}

// ─────────────────────────── 表格抽取 ───────────────────────────

type Field =
  | "description"
  | "specification"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "amount"
  | "date"
  | "docRef"
  | "instrument"
  | "destination"
  | "currency"
  | "taxFreight"
  | "type";

const SYNONYMS: Array<[Field, string[]]> = [
  ["unitPrice", ["unit price", "price per unit", "prix unitaire", "unit cost", "cout unitaire", "price"]],
  ["quantity", ["quantity", "qty", "quantite", "qte", "qty ordered", "quantity ordered", "quantite commandee"]],
  ["unit", ["unit of measure", "uom", "u m", "unit", "unite", "unite de mesure"]],
  ["amount", ["amount", "total", "line total", "extended price", "extended amount", "value", "montant", "valeur", "order value", "call up value", "invoice amount", "invoiced amount", "amount invoiced", "paid amount", "amount paid", "payment amount", "committed amount", "amount committed", "total value"]],
  ["date", ["date", "order date", "po date", "invoice date", "payment date", "call up date", "date de commande", "date de facture", "date de paiement"]],
  ["docRef", ["po number", "po", "po no", "purchase order", "purchase order number", "call up number", "call up no", "call up", "invoice number", "invoice no", "invoice", "reference", "document number", "numero de commande", "numero de facture"]],
  ["instrument", ["contract number", "contract no", "standing offer", "standing offer number", "so number", "contract", "numero de contrat", "offre a commandes"]],
  ["description", ["description", "item description", "item", "article", "product", "produit", "designation", "commodity", "goods"]],
  ["specification", ["specification", "spec", "size", "taille", "dimensions", "colour", "color"]],
  ["destination", ["delivery location", "destination", "ship to", "delivery address", "lieu de livraison", "delivery point", "consignee"]],
  ["currency", ["currency", "devise"]],
  ["taxFreight", ["tax", "taxes", "gst", "hst", "pst", "freight", "shipping", "taxe", "transport"]],
  ["type", ["type", "document type", "transaction type", "status", "statut"]],
];

function classifyHeader(h: string): Field | null {
  const f = foldText(h);
  if (!f) return null;
  for (const [field, syns] of SYNONYMS) if (syns.includes(f)) return field;
  for (const [field, syns] of SYNONYMS) if (syns.some((s) => s.length >= 4 && f.includes(s))) return field;
  return null;
}

export function basisFromText(text: string | null | undefined): AmountBasis {
  const f = foldText(text);
  if (!f) return "UNKNOWN";
  if (/\b(invoice|invoiced|facture|facturee?)\b/.test(f)) return "INVOICED";
  if (/\b(paid|payment|payments|paiement|paye)\b/.test(f)) return "PAID";
  if (/\b(commit|committed|commitment|engage|engagement)\b/.test(f)) return "COMMITTED";
  if (/\b(ceiling|limit|plafond|maximum|not to exceed)\b/.test(f)) return "CEILING";
  if (/\b(evaluated|evaluation|evalue)\b/.test(f)) return "EVALUATED";
  if (/\b(order|ordered|orders|call up|callup|commande|po)\b/.test(f)) return "ORDERED";
  return "UNKNOWN";
}

function docTypeFor(basis: AmountBasis, typeText: string | null, docRefHeader: string | null): { documentType: DocumentType; amendmentMode: ExtractedLine["amendmentMode"] } {
  const t = foldText(typeText);
  if (/\b(amendment|modification|revision)\b/.test(t)) {
    const mode = /\b(revised total|new total|total revise|montant revise)\b/.test(t) ? "REVISED_TOTAL" : /\b(increase|increment|augmentation|additional)\b/.test(t) ? "INCREMENT" : "UNKNOWN";
    return { documentType: "AMENDMENT", amendmentMode: mode };
  }
  if (/\b(usage report|rapport d utilisation)\b/.test(t)) return { documentType: "USAGE_REPORT", amendmentMode: null };
  switch (basis) {
    case "ORDERED":
      return { documentType: /call up/.test(foldText(docRefHeader)) ? "CALL_UP" : "PURCHASE_ORDER", amendmentMode: null };
    case "INVOICED":
      return { documentType: "INVOICE", amendmentMode: null };
    case "PAID":
      return { documentType: "PAYMENT", amendmentMode: null };
    case "CEILING":
      return { documentType: "CONTRACT", amendmentMode: null };
    default:
      return { documentType: "OTHER", amendmentMode: null };
  }
}

const SUMMARY_ROW = /^(grand total|total|sub ?total|sous total|totaux?)\b/;
const CREDIT_WORDS = /\b(credit|credit note|return|returned|refund|cancel|cancelled|cancellation|annulation|avoir|remboursement)\b/;

export interface TableExtractResult {
  lines: ExtractedLine[];
  headerRow: number | null;
  mappedColumns: Partial<Record<Field, string>>;
  skippedSummaryRows: number;
  note: string | null;
}

export function extractFromTable(input: { sheet: string; csvText: string; unitIndex: number }): TableExtractResult {
  const rows = parseCsv(input.csvText);
  let headerIdx = -1;
  let map: Array<Field | null> = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = rows[i].map(classifyHeader);
    const hits = new Set(m.filter((x): x is Field => !!x));
    const strong = ["quantity", "unitPrice", "amount", "docRef", "description", "date"].filter((f) => hits.has(f as Field)).length;
    if (strong >= 2 && (hits.has("amount") || hits.has("quantity") || hits.has("unitPrice"))) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) return { lines: [], headerRow: null, mappedColumns: {}, skippedSummaryRows: 0, note: "未找到可识别的表头（需要至少两列：数量 / 单价 / 金额 / 单号 / 描述 / 日期）——请人工录入" };
  const headers = rows[headerIdx];
  const col = (f: Field) => map.indexOf(f);
  const mapped: Partial<Record<Field, string>> = {};
  map.forEach((f, i) => {
    if (f && !mapped[f]) mapped[f] = headers[i];
  });
  const amountHeader = col("amount") >= 0 ? headers[col("amount")] : null;
  const basisFromHeader = basisFromText(amountHeader);
  const sheetBasis = basisFromText(input.sheet);
  const basis: AmountBasis = basisFromHeader !== "UNKNOWN" ? basisFromHeader : sheetBasis;
  const docRefHeader = col("docRef") >= 0 ? headers[col("docRef")] : null;

  const lines: ExtractedLine[] = [];
  let skipped = 0;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (f: Field) => (col(f) >= 0 ? (row[col(f)] ?? "").trim() || null : null);
    if (row.every((c) => !c.trim())) continue;
    const first = foldText(row.find((c) => c.trim()) ?? "");
    if (SUMMARY_ROW.test(first) || SUMMARY_ROW.test(foldText(cell("description")))) {
      skipped++;
      continue;
    }
    const amount = parseDecimal(cell("amount"));
    const qty = parseDecimal(cell("quantity"));
    const up = parseDecimal(cell("unitPrice"));
    if (amount.value === null && qty.value === null && up.value === null) continue;
    const typeText = cell("type");
    const rowText = row.join(" | ");
    const isCredit = amount.negative || CREDIT_WORDS.test(foldText(typeText)) || CREDIT_WORDS.test(foldText(cell("description")));
    const rowBasis = basis !== "UNKNOWN" ? basis : basisFromText(typeText);
    const { documentType, amendmentMode } = docTypeFor(rowBasis, typeText, docRefHeader);
    let amt = amount.value;
    if (isCredit && amt && !amt.startsWith("-") && Number(amt) !== 0) amt = `-${amt}`;
    const inst = cell("instrument");
    lines.push({
      dedupeKey: `u${input.unitIndex}:r${r + 1}`,
      instrumentNumber: inst ? normalizeInstrumentNumber(inst).normalized || null : null,
      documentType,
      amountBasis: rowBasis,
      amendmentMode,
      docRef: cell("docRef"),
      linkedRef: null,
      docDate: parseUnambiguousDate(cell("date")),
      productDescription: cell("description"),
      specification: cell("specification"),
      quantity: qty.value,
      unit: cell("unit"),
      unitPrice: up.value,
      amount: amt,
      currency: cell("currency")?.toUpperCase().slice(0, 3) ?? null,
      deliveryLocation: cell("destination"),
      taxFreightNote: cell("taxFreight"),
      isCancellationOrCredit: isCredit,
      sourceUnitIndex: input.unitIndex,
      sourcePage: null,
      sourceSheet: input.sheet,
      sourceRow: r + 1,
      rawSnippet: rowText.slice(0, 1000),
      extractionMethod: "TABLE_COLUMN_MAP",
    });
  }
  return {
    lines,
    headerRow: headerIdx + 1,
    mappedColumns: mapped,
    skippedSummaryRows: skipped,
    note: basis === "UNKNOWN" ? "金额列口径无法从表头 / 工作表名判定（UNKNOWN），请复核时指定" : null,
  };
}

// ─────────────────────────── PDF 文本行抽取 ───────────────────────────

const MONEY_RE = /\(?-?\$?\s?\d{1,3}(?:[, ]\d{3})*\.\d{2}\)?(?:\s?CR)?|\(?-?\$?\s?\d+\.\d{2}\)?/g;
const INSTRUMENT_RE = /\b(?:[A-Z]{1,3}\d{6,9}(?:-\d{3})?|W\d{4}-\d{2}[A-Z0-9]{2,6}|[A-Z]{2}\d{9,11})\b/;
const DOCREF_RE = /\b(?:PO|P\.O\.|Call[- ]?up|Invoice|Inv\.?|Facture|Commande)\s*(?:No\.?|#|Number|n[o°])?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i;

export function extractFromPdfPage(input: { pageText: string; pageNumber: number; unitIndex: number; maxLines?: number }): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  const lines = input.pageText.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const pageInstrument = INSTRUMENT_RE.exec(input.pageText)?.[0] ?? null;
  lines.forEach((line, idx) => {
    if (out.length >= (input.maxLines ?? 300)) return;
    const money = line.match(MONEY_RE);
    if (!money || money.length === 0) return;
    if (SUMMARY_ROW.test(foldText(line))) return;
    const last = money[money.length - 1];
    const amount = parseDecimal(last);
    if (amount.value === null) return;
    const isCredit = amount.negative || CREDIT_WORDS.test(foldText(line));
    let amt = amount.value;
    if (isCredit && !amt.startsWith("-") && Number(amt) !== 0) amt = `-${amt}`;
    const basis = basisFromText(line);
    const ref = DOCREF_RE.exec(line)?.[1] ?? null;
    const inst = INSTRUMENT_RE.exec(line)?.[0] ?? pageInstrument;
    out.push({
      dedupeKey: `u${input.unitIndex}:l${idx + 1}`,
      instrumentNumber: inst ? normalizeInstrumentNumber(inst).normalized : null,
      documentType: docTypeFor(basis, line, line).documentType,
      amountBasis: basis,
      amendmentMode: /\b(amendment|modification)\b/i.test(line) ? "UNKNOWN" : null,
      docRef: ref,
      linkedRef: null,
      docDate: null,
      productDescription: line.replace(MONEY_RE, "").replace(/\s+/g, " ").trim().slice(0, 300) || null,
      specification: null,
      quantity: null,
      unit: null,
      unitPrice: null,
      amount: amt,
      currency: /\bUSD\b/.test(line) ? "USD" : /\bCAD\b|\$/.test(line) ? null : null,
      deliveryLocation: null,
      taxFreightNote: /\b(gst|hst|pst|tax|freight)\b/i.test(line) ? "行内提到税 / 运费，需复核" : null,
      isCancellationOrCredit: isCredit,
      sourceUnitIndex: input.unitIndex,
      sourcePage: input.pageNumber,
      sourceSheet: null,
      sourceRow: idx + 1,
      rawSnippet: line.slice(0, 1000),
      extractionMethod: "PDF_TEXT_LINE",
    });
  });
  return out;
}

/** 页面有效文字太少 → 需要 OCR（不臆测内容） */
export function pageNeedsOcr(text: string): boolean {
  return text.replace(/\s+/g, "").length < 20;
}
