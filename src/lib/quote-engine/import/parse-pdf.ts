/**
 * 供应商 PDF 报价抽取（基础版，确定性）：页文本 → 行 → 「描述 + 尾部金额」。
 * 保留页码 / 原始金额文本 / 规范化金额；所有行默认低置信度进入 Review，绝不悄悄猜。
 * OCR 不在本仓库内（扫描件 → OCR_REQUIRED 页为空文本 → 抽不到行，说明在 notes）。
 */

import { classifyDescription, extractRatePct, looksLikeTotalLine, normalizeDescription } from "./classify";
import { IMPORT_EXTRACTION_VERSION, LOW_CONFIDENCE_THRESHOLD, type ExtractionResult, type ImportRow, type ImportRowWarning, type ReconciliationResult } from "./contract";
import { reconcileTotals } from "./reconcile";
import { detectCurrencyToken } from "./parse-xlsx";

export type PdfPageText = { pageNumber: number; contentText: string };

const MONEY = String.raw`(?:(?:CAD|USD|CNY|RMB|EUR|GBP|C\$|US\$|\$|¥|￥|€|£)\s*)?\(?-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?|(?:(?:CAD|USD|CNY|RMB|EUR|GBP|C\$|US\$|\$|¥|￥|€|£)\s*)?\(?-?\d+\.\d{2}\)?|(?:(?:CAD|USD|CNY|RMB|EUR|GBP|C\$|US\$|\$|¥|￥|€|£)\s*)\(?-?\d+\)?`;
const TRAILING_MONEY_RE = new RegExp(`(${MONEY})\\s*$`);
const NUM_TOKEN_RE = /(?:CAD|USD|CNY|RMB|EUR|GBP|C\$|US\$|\$|¥|￥|€|£)?\s*\(?-?\d[\d,]*(?:\.\d+)?\)?/g;

function toNumber(token: string): number | null {
  const neg = /^\(.*\)$/.test(token.trim()) || /-\d/.test(token);
  const cleaned = token.replace(/[()A-Za-z$€£¥￥,\s-]/g, "");
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function documentCurrency(pages: PdfPageText[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const explicit = p.contentText.match(/(?:all\s+prices?\s+(?:are\s+)?in|currency|prices?\s+in|币种|货币)\s*[:：]?\s*(CAD|USD|CNY|RMB|EUR|GBP|C\$|US\$)/i);
    if (explicit) return detectCurrencyToken(explicit[1]!);
    for (const m of p.contentText.matchAll(/\b(CAD|USD|CNY|RMB|EUR|GBP)\b|C\$|US\$/g)) {
      const c = detectCurrencyToken(m[0]);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

export function extractRowsFromPdfPages(pages: PdfPageText[], opts: { confirmedCurrency?: string | null } = {}): ExtractionResult {
  const rows: ImportRow[] = [];
  const notes: string[] = [];
  const docCcy = documentCurrency(pages) ?? opts.confirmedCurrency ?? null;
  let skippedTotals = 0;
  let emptyPages = 0;
  let supplierNameGuess: string | null = null;
  let quoteDateGuess: string | null = null;
  let subtotalRef: number | null = null;
  let totalRef: number | null = null;
  for (const page of pages) {
    const text = page.contentText ?? "";
    if (text.trim().length < 16) { emptyPages += 1; continue; }
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    lines.forEach((line, li) => {
      if (!supplierNameGuess) {
        const m = line.match(/^(?:supplier|vendor|from|quotation\s+from|供应商|卖方)\s*[:：]\s*(.+)$/i);
        if (m) supplierNameGuess = m[1]!.trim().slice(0, 120);
        else if (li < 6 && /\b(ltd|inc|llc|corp|limited|co\.)\b|有限公司/i.test(line) && line.length <= 80) supplierNameGuess = line.slice(0, 120);
      }
      if (!quoteDateGuess) {
        const d = line.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
        if (d) quoteDateGuess = `${d[1]}-${d[2]!.padStart(2, "0")}-${d[3]!.padStart(2, "0")}`;
      }
      const tm = line.match(TRAILING_MONEY_RE);
      if (!tm) return;
      const amountToken = tm[1]!;
      const head = line.slice(0, line.length - tm[0].length).trim();
      const amount = toNumber(amountToken);
      if (amount == null) return;
      // head 内所有数字 token（含币种符号/千分位）：最后两个若满足 qty × unit ≈ amount → PER_UNIT，并把尾部数字/运算符从描述剥离
      const headTokens = [...head.matchAll(NUM_TOKEN_RE)].map((m) => ({ text: m[0], index: m.index ?? 0, value: toNumber(m[0]) })).filter((t): t is { text: string; index: number; value: number } => t.value != null);
      let quantity: number | null = null;
      let unitCost: number | null = null;
      let desc = head;
      if (headTokens.length >= 2) {
        const q = headTokens[headTokens.length - 2]!;
        const u = headTokens[headTokens.length - 1]!;
        if (q.value > 0 && Math.abs(q.value * u.value - amount) <= Math.max(1, Math.abs(amount) * 0.01)) {
          quantity = q.value;
          unitCost = u.value;
          const between = head.slice(q.index + q.text.length, u.index);
          const tail = head.slice(u.index + u.text.length);
          if (/^[\s×x@*]*$/i.test(between) && /^[\s]*$/.test(tail)) desc = head.slice(0, q.index);
        }
      }
      desc = desc.replace(/[\s×x@*:：-]+$/i, "").replace(/\s+/g, " ").trim();
      if (!desc || !/[A-Za-z一-鿿]{2,}/.test(desc)) return;
      if (looksLikeTotalLine(desc)) { skippedTotals += 1; if (amount != null) { if (/^(sub\s*-?\s*total|小计)/i.test(desc)) subtotalRef = amount; else if (/^(grand\s*total|total|总计|合计|总额)/i.test(desc)) totalRef = amount; } return; }
      const cls = classifyDescription(desc);
      const warnings: ImportRowWarning[] = [];
      // P1：利润不是成本——识别为 PROFIT 的行默认不导入（人工可重新勾选）
      const isProfit = cls.category === "PROFIT";
      if (isProfit) warnings.push("PROFIT_PRICING_RULE_RECOMMENDED");
      const currency = detectCurrencyToken(amountToken) ?? docCcy;
      if (!currency) warnings.push("MISSING_CURRENCY");
      if (amount < 0) warnings.push("NEGATIVE_AMOUNT");
      if (cls.ambiguous || !cls.category) warnings.push("AMBIGUOUS_CATEGORY");
      // PDF 行式抽取本身不如表格可靠：置信度封顶 0.7，数量×单价核对一致才到 0.7
      const confidence = Math.min(cls.confidence, quantity != null ? 0.7 : 0.55);
      if (confidence < LOW_CONFIDENCE_THRESHOLD) warnings.push("LOW_CONFIDENCE");
      rows.push({
        rowId: `p${page.pageNumber}l${li + 1}`,
        sourceDescription: desc.slice(0, 300),
        suggestedDescription: normalizeDescription(desc),
        quantity,
        unit: null,
        unitCost: quantity != null ? unitCost : amount,
        sourceAmount: amount,
        rawAmountText: amountToken.slice(0, 60),
        sourceCurrency: currency,
        suggestedCategory: cls.category,
        suggestedCalculationType: quantity != null ? "PER_UNIT" : "FIXED",
        suggestedCalculationBase: null,
        suggestedRate: extractRatePct(desc),
        confidence,
        include: !isProfit,
        userEdited: false,
        aiSuggested: false,
        warnings,
        evidence: { documentId: null, pageNumber: page.pageNumber, unitLabel: null, sheet: null, row: li + 1, cell: null, snippet: line.slice(0, 300) },
        notes: null,
      });
    });
  }
  if (skippedTotals > 0) notes.push(`跳过合计/税/应付行 ${skippedTotals} 条`);
  if (emptyPages > 0) notes.push(`${emptyPages} 页无可抽取文本（扫描件需 OCR，本版本不支持）`);
  if (rows.length === 0) notes.push("未从 PDF 文本抽取到「描述 + 金额」行；请改用 Excel 或手工录入");
  const referenceTotal = subtotalRef ?? totalRef;
  const rec = reconcileTotals({ referenceTotal, extractedTotal: rows.reduce((s, r) => s + (r.sourceAmount ?? 0), 0) });
  if (rec.status === "MISMATCH") notes.push(`RECONCILIATION_MISMATCH：抽取合计 ${rec.extractedTotal.toLocaleString("en-CA")} 与 PDF 的 Total ${rec.referenceTotal!.toLocaleString("en-CA")} 相差 ${rec.difference!.toLocaleString("en-CA")}（容差 ${rec.tolerance!.toFixed(2)}）——请逐行核对`);
  const reconciliation: ReconciliationResult = { ...rec, sheets: [{ sheet: "PDF", referenceTotal: rec.referenceTotal, referenceSource: referenceTotal != null ? "explicit_total" : null, referenceRow: null, extractedTotal: rec.extractedTotal, difference: rec.difference, tolerance: rec.tolerance, status: rec.status }] };
  return { extractionVersion: IMPORT_EXTRACTION_VERSION, sourceType: "PDF", rows: rows.slice(0, 500), sheets: [], pages: pages.length, detectedCurrency: docCcy, supplierNameGuess, quoteDateGuess, notes, reconciliation };
}
