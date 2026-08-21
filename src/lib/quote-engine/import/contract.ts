/**
 * Quote Operations Phase 2 · 成本导入契约（词表 / Review 行结构 / zod）
 *
 * 链路：Upload → Extract → Normalize → Review → Confirm → Apply → QuoteCostLine。
 * 纪律：
 *  - 抽取结果绝不直接成为正式成本；所有导入必须人工 Review + Confirm。
 *  - 金额 / 数量优先来自确定性抽取；AI 只能 classify / normalize description / suggest category，绝不改数字。
 *  - 每行保留 provenance（文档 / 工作表 / 行号 / 页码 / 原始文本），未来必须能回答「这个 $20,000 从哪张供应商报价来的」。
 */

import { z } from "zod";
import { COST_CATEGORIES } from "../contract";

export const IMPORT_EXTRACTION_VERSION = "quote-import-extract/v1" as const;

export const IMPORT_SOURCE_TYPES = ["XLSX", "CSV", "PDF"] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export const IMPORT_STATUSES = ["UPLOADED", "EXTRACTING", "REVIEW_REQUIRED", "CONFIRMED", "APPLIED", "FAILED", "CANCELLED"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** 可编辑（Review）状态：Review 行可改；CONFIRMED 再改会退回 REVIEW_REQUIRED */
export const IMPORT_EDITABLE_STATUSES: readonly ImportStatus[] = ["REVIEW_REQUIRED", "CONFIRMED"];
/** 终态：不可再改 */
export const IMPORT_TERMINAL_STATUSES: readonly ImportStatus[] = ["APPLIED", "FAILED", "CANCELLED"];

export const IMPORT_ROW_WARNINGS = [
  "MISSING_AMOUNT",
  "MISSING_CURRENCY",
  "AMBIGUOUS_CATEGORY",
  "LOW_CONFIDENCE",
  "NEGATIVE_AMOUNT",
  "UNPARSED_NUMBER",
  "QTY_PRICE_MISMATCH",
] as const;
export type ImportRowWarning = (typeof IMPORT_ROW_WARNINGS)[number];

/** 导入行只允许两种确定性算法；百分比类由用户在 Cost Builder 改（suggestedRate 仅作提示） */
export const IMPORT_CALC_TYPES = ["FIXED", "PER_UNIT"] as const;

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const num = () => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.number().finite().nullable());

export const importEvidenceSchema = z.object({
  /** 复用 ProjectDocument.id（sourceDocumentId） */
  documentId: z.string().nullable(),
  /** ProjectDocumentPage.pageNumber（PDF = 真实页码；xlsx = 工作表单元序号）；未落页时 null */
  pageNumber: z.number().int().positive().nullable(),
  unitLabel: z.string().max(120).nullable(),
  sheet: z.string().max(120).nullable(),
  /** 源文件行号（Excel 1-based 行；PDF 为页内行序） */
  row: z.number().int().positive().nullable(),
  cell: z.string().max(20).nullable(),
  /** 原文片段（逐字，≤300） */
  snippet: z.string().max(300),
});
export type ImportEvidence = z.infer<typeof importEvidenceSchema>;

export const importRowSchema = z.object({
  rowId: z.string().min(1).max(40),
  sourceDescription: z.string().max(300),
  suggestedDescription: z.string().max(300),
  quantity: num(),
  unit: z.string().max(30).nullable(),
  unitCost: num(),
  /** 源文件行总额（原币） */
  sourceAmount: num(),
  rawAmountText: z.string().max(60).nullable(),
  sourceCurrency: z.string().max(3).nullable(),
  suggestedCategory: z.string().max(40).nullable(),
  suggestedCalculationType: z.enum(IMPORT_CALC_TYPES),
  suggestedCalculationBase: z.string().max(60).nullable(),
  /** 源文件出现的百分比（如 Bond 1.5%）仅提示，不参与导入计算 */
  suggestedRate: num(),
  confidence: z.number().min(0).max(1),
  include: z.boolean(),
  userEdited: z.boolean(),
  aiSuggested: z.boolean().default(false),
  warnings: z.array(z.enum(IMPORT_ROW_WARNINGS)),
  evidence: importEvidenceSchema,
  notes: z.string().max(500).nullable().optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importReviewPatchSchema = z.object({
  rows: z.array(importRowSchema).max(500),
  supplierName: z.string().max(120).nullable().optional(),
  quoteDate: z.string().max(10).nullable().optional(),
  defaultCurrency: z.string().length(3).nullable().optional(),
});
export type ImportReviewPatch = z.infer<typeof importReviewPatchSchema>;

export type ExtractionResult = {
  extractionVersion: typeof IMPORT_EXTRACTION_VERSION;
  sourceType: ImportSourceType;
  rows: ImportRow[];
  sheets: string[];
  pages: number | null;
  detectedCurrency: string | null;
  supplierNameGuess: string | null;
  quoteDateGuess: string | null;
  /** 抽取器说明（跳过的合计行数、未识别表头等）——给 Review 界面看，不是错误 */
  notes: string[];
};

export const IMPORT_SUPPORTED_EXTENSIONS = ["xlsx", "xls", "csv", "pdf"] as const;
export function sourceTypeOfExtension(ext: string): ImportSourceType | null {
  const e = ext.toLowerCase();
  if (e === "xlsx" || e === "xls") return "XLSX";
  if (e === "csv") return "CSV";
  if (e === "pdf") return "PDF";
  return null;
}

export function isKnownCostCategory(v: string | null | undefined): boolean {
  return !!v && (COST_CATEGORIES as readonly string[]).includes(v);
}

/** Confirm 前的行级校验（fail-closed：任一 included 行不合格 → 整体拒绝，不做半成功） */
export type ImportRowIssue = { rowId: string; code: "MISSING_AMOUNT" | "MISSING_CURRENCY" | "MISSING_CATEGORY" | "INVALID_CATEGORY" | "INVALID_QUANTITY" | "NEGATIVE_AMOUNT" | "EMPTY_DESCRIPTION"; message: string };

export function validateRowsForConfirm(rows: readonly ImportRow[]): ImportRowIssue[] {
  const issues: ImportRowIssue[] = [];
  for (const r of rows) {
    if (!r.include) continue;
    const desc = (r.suggestedDescription || r.sourceDescription).trim();
    if (!desc) issues.push({ rowId: r.rowId, code: "EMPTY_DESCRIPTION", message: "描述为空" });
    if (!r.sourceCurrency) issues.push({ rowId: r.rowId, code: "MISSING_CURRENCY", message: "缺少币种（请在 Review 中指定）" });
    if (!r.suggestedCategory) issues.push({ rowId: r.rowId, code: "MISSING_CATEGORY", message: "缺少成本类别（请确认 Suggested Category）" });
    else if (!isKnownCostCategory(r.suggestedCategory)) issues.push({ rowId: r.rowId, code: "INVALID_CATEGORY", message: `未知类别 ${r.suggestedCategory}` });
    if (r.suggestedCalculationType === "PER_UNIT") {
      if (r.quantity == null || !(r.quantity > 0)) issues.push({ rowId: r.rowId, code: "INVALID_QUANTITY", message: "PER_UNIT 行数量必须 > 0" });
      if (r.unitCost == null) issues.push({ rowId: r.rowId, code: "MISSING_AMOUNT", message: "PER_UNIT 行缺少单价" });
      else if (r.unitCost < 0) issues.push({ rowId: r.rowId, code: "NEGATIVE_AMOUNT", message: "单价不得为负" });
    } else {
      const amt = r.sourceAmount ?? r.unitCost;
      if (amt == null) issues.push({ rowId: r.rowId, code: "MISSING_AMOUNT", message: "缺少金额" });
      else if (amt < 0) issues.push({ rowId: r.rowId, code: "NEGATIVE_AMOUNT", message: "金额不得为负" });
    }
  }
  return issues;
}
