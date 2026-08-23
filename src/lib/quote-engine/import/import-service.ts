/**
 * 成本导入服务（DB）：Upload → Extract → Review → Confirm → Apply。
 *  - 文档存储复用 ProjectDocument + putPrivateBlob（projects/{projectId}/quote-imports/…）；可引用单元复用 parseDocumentPagesAndStore。
 *  - 抽取结果存 extractedJson（不可变）；人工编辑存 reviewJson；Apply 后成本行 metadata 带完整 provenance。
 *  - 重复导入：同 quote + 同 contentHash 且未取消/失败 → SOURCE_ALREADY_IMPORTED（显式 reimport 才允许）。
 *  - 冻结态报价（approved/superseded/awarded/cancelled）不可导入。
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { extractPdfPagesFromBuffer, parseDocumentPagesAndStore } from "@/lib/tender-auto-analysis/page-parse";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { FROZEN_STATUSES, type CostLinePayload } from "../contract";
import { getQuote, QuoteEngineError, snapshotQuote, type QuoteRecord } from "../service";
import { classifyLowConfidenceRows } from "./classify-ai";
import {
  IMPORT_EDITABLE_STATUSES,
  IMPORT_EXTRACTION_VERSION,
  importReviewPatchSchema,
  importRowSchema,
  sourceTypeOfExtension,
  validateRowsForConfirm,
  type ExtractionResult,
  type ImportRow,
  type ImportStatus,
} from "./contract";
import { extractRowsFromPdfPages } from "./parse-pdf";
import { extractRowsFromWorkbook } from "./parse-xlsx";

export const IMPORT_AUDIT_ACTIONS = {
  QUOTE_IMPORT_CREATED: "quote_import_created",
  QUOTE_IMPORT_REVIEWED: "quote_import_reviewed",
  QUOTE_IMPORT_CONFIRMED: "quote_import_confirmed",
  QUOTE_IMPORT_APPLIED: "quote_import_applied",
  QUOTE_IMPORT_CANCELLED: "quote_import_cancelled",
  QUOTE_IMPORT_FAILED: "quote_import_failed",
} as const;
export const IMPORT_AUDIT_TARGET = "quote_cost_import";

export type ImportRecord = Prisma.QuoteCostImportGetPayload<Record<string, never>>;

export const IMPORT_MAX_FILE_SIZE = 20 * 1024 * 1024;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeCurrency(v: string | null | undefined): string | null {
  const c = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

const D = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)));

function assertQuoteImportable(q: { status: string }) {
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", `状态 ${q.status} 的报价已冻结，不能导入成本；请先创建修订版本`, 409);
}

function rowsOf(record: { reviewJson: Prisma.JsonValue | null; extractedJson: Prisma.JsonValue | null }): ImportRow[] {
  const src = (record.reviewJson as { rows?: unknown } | null)?.rows ?? (record.extractedJson as { rows?: unknown } | null)?.rows ?? [];
  if (!Array.isArray(src)) return [];
  const out: ImportRow[] = [];
  for (const r of src) {
    const p = importRowSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

export function importRows(record: ImportRecord): ImportRow[] {
  return rowsOf(record);
}

async function audit(input: { userId: string; orgId: string; projectId: string; action: string; importId: string; after?: unknown; before?: unknown }) {
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: input.action, targetType: IMPORT_AUDIT_TARGET, targetId: input.importId, beforeData: input.before, afterData: input.after }).catch(() => undefined);
}

export async function listImports(input: { quoteId: string; projectId: string; orgId: string }): Promise<ImportRecord[]> {
  return db.quoteCostImport.findMany({ where: { quoteId: input.quoteId, projectId: input.projectId, orgId: input.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getImport(input: { importId: string; quoteId: string; projectId: string; orgId: string }): Promise<ImportRecord> {
  const r = await db.quoteCostImport.findFirst({ where: { id: input.importId, quoteId: input.quoteId, projectId: input.projectId, orgId: input.orgId } });
  if (!r) throw new QuoteEngineError("IMPORT_NOT_FOUND", "导入记录不存在", 404);
  return r;
}

/** xlsx 行 → 可引用单元（ProjectDocumentPage）：按工作表名 + 行区间匹配（单元行号为非空行计数，近似匹配） */
function attachSheetEvidence(rows: ImportRow[], documentId: string, pages: Array<{ pageNumber: number; unitLabel: string | null }>) {
  for (const row of rows) {
    row.evidence.documentId = documentId;
    if (!row.evidence.sheet) continue;
    const prefix = `Sheet「${row.evidence.sheet}」`;
    const candidates = pages.filter((p) => p.unitLabel?.startsWith(prefix));
    if (candidates.length === 0) continue;
    let pick = candidates[0]!;
    if (candidates.length > 1 && row.evidence.row != null) {
      const inRange = candidates.find((p) => {
        const m = p.unitLabel?.match(/行 (\d+)–(\d+)/);
        return !!m && row.evidence.row! >= Number(m[1]) && row.evidence.row! <= Number(m[2]);
      });
      if (inRange) pick = inRange;
    }
    row.evidence.pageNumber = pick.pageNumber;
    row.evidence.unitLabel = pick.unitLabel;
  }
}

export async function createImportFromUpload(input: {
  orgId: string;
  projectId: string;
  quoteId: string;
  userId: string;
  file: { buffer: Buffer; filename: string; safeName: string; ext: string; mime: string | null; size: number };
  supplierName?: string | null;
  quoteDate?: string | null;
  /** B3：供应商源币种 = 人工显式确认值（可选）；绝不用报价币种兜底。未给且无文档信号 → 行 UNRESOLVED（MISSING_CURRENCY，Confirm 被挡） */
  supplierCurrency?: string | null;
  reimport?: boolean;
  ai?: { enabled: boolean; invoker?: LlmInvoker };
}): Promise<{ record: ImportRecord; extraction: ExtractionResult | null }> {
  const quote = await getQuote(input.quoteId, input.projectId);
  if (quote.orgId !== input.orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  assertQuoteImportable(quote);
  const sourceType = sourceTypeOfExtension(input.file.ext);
  if (!sourceType) throw new QuoteEngineError("IMPORT_UNSUPPORTED_TYPE", "仅支持 xlsx / xls / csv / pdf", 400);
  if (input.file.size > IMPORT_MAX_FILE_SIZE) throw new QuoteEngineError("IMPORT_FILE_TOO_LARGE", "文件超过 20MB", 400);
  const contentHash = sha256(input.file.buffer);
  const dup = await db.quoteCostImport.findFirst({ where: { quoteId: input.quoteId, contentHash, status: { notIn: ["CANCELLED", "FAILED"] } }, select: { id: true, status: true, createdAt: true } });
  if (dup && !input.reimport) {
    throw new QuoteEngineError("SOURCE_ALREADY_IMPORTED", `同一文件已导入（${dup.status}）；如需再次导入请显式选择「重新导入为新版本」`, 409, { importId: dup.id, status: dup.status, createdAt: dup.createdAt });
  }
  const blob = await putPrivateBlob({ pathname: `projects/${input.projectId}/quote-imports/${input.quoteId}/${Date.now()}_${input.file.safeName}`, body: input.file.buffer, contentType: input.file.mime ?? "application/octet-stream" });
  const doc = await db.projectDocument.create({
    data: { projectId: input.projectId, title: input.file.filename, url: blob.proxyUrl, blobUrl: blob.proxyUrl, fileType: input.file.ext.toLowerCase(), fileSize: input.file.size, parseStatus: "pending", source: "quote_import", uploadedById: input.userId, contentHash },
    select: { id: true },
  });
  const supplierCurrency = normalizeCurrency(input.supplierCurrency);
  if (input.supplierCurrency && !supplierCurrency) throw new QuoteEngineError("IMPORT_CURRENCY_INVALID", "供应商币种必须是 3 位 ISO 代码（如 CNY / USD / CAD）", 400);
  let record = await db.quoteCostImport.create({
    data: {
      orgId: input.orgId, projectId: input.projectId, quoteId: input.quoteId, sourceDocumentId: doc.id, sourceType, sourceFilename: input.file.filename, contentHash, status: "EXTRACTING",
      supplierName: input.supplierName?.trim() || null, quoteDate: input.quoteDate ? new Date(input.quoteDate) : null,
      metadataJson: { supplierCurrency, currencyMode: supplierCurrency ? "CONFIRMED" : "AUTO_DETECT", reimportOf: dup?.id ?? null, mime: input.file.mime, size: input.file.size } as Prisma.InputJsonValue,
      createdById: input.userId,
    },
  });
  await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_CREATED, importId: record.id, after: { sourceType, filename: input.file.filename, contentHash, sourceDocumentId: doc.id, reimportOf: dup?.id ?? null } });

  try {
    let extraction: ExtractionResult;
    if (sourceType === "PDF") {
      const pdf = await extractPdfPagesFromBuffer(input.file.buffer);
      extraction = extractRowsFromPdfPages(pdf.pages.map((p) => ({ pageNumber: p.pageNumber, contentText: p.contentText })), { confirmedCurrency: supplierCurrency });
    } else {
      extraction = extractRowsFromWorkbook(input.file.buffer, { confirmedCurrency: supplierCurrency, sourceType });
    }
    // 可引用单元（best-effort；失败不影响导入）
    const parsed = await parseDocumentPagesAndStore(doc.id, { contentHash }).catch(() => null);
    if (parsed && parsed.ok) {
      if (sourceType === "PDF") for (const r of extraction.rows) r.evidence.documentId = doc.id;
      else {
        const pages = await db.projectDocumentPage.findMany({ where: { documentId: doc.id }, select: { pageNumber: true, unitLabel: true }, orderBy: { pageNumber: "asc" } });
        attachSheetEvidence(extraction.rows, doc.id, pages);
      }
    } else {
      for (const r of extraction.rows) r.evidence.documentId = doc.id;
    }
    let aiUpdated = 0;
    if (input.ai?.enabled && extraction.rows.length > 0) {
      const res = await classifyLowConfidenceRows(extraction.rows, { invoker: input.ai.invoker });
      aiUpdated = res.updated;
    }
    const status: ImportStatus = "REVIEW_REQUIRED";
    record = await db.quoteCostImport.update({
      where: { id: record.id },
      data: {
        status,
        extractionVersion: IMPORT_EXTRACTION_VERSION,
        extractedJson: JSON.parse(JSON.stringify(extraction)) as Prisma.InputJsonValue,
        reviewJson: JSON.parse(JSON.stringify({ rows: extraction.rows })) as Prisma.InputJsonValue,
        supplierName: record.supplierName ?? extraction.supplierNameGuess ?? null,
        quoteDate: record.quoteDate ?? (extraction.quoteDateGuess ? new Date(extraction.quoteDateGuess) : null),
        metadataJson: { ...(record.metadataJson as Record<string, unknown>), detectedCurrency: extraction.detectedCurrency, notes: extraction.notes, sheets: extraction.sheets, pages: extraction.pages, aiUpdated, rowCount: extraction.rows.length, unresolvedCurrencyRows: extraction.rows.filter((r) => r.include && !r.sourceCurrency).length, reconciliation: extraction.reconciliation, profitRowsExcluded: extraction.rows.filter((r) => r.warnings.includes("PROFIT_PRICING_RULE_RECOMMENDED")).length, ambiguousAmountRows: extraction.rows.filter((r) => r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN")).length } as Prisma.InputJsonValue,
      },
    });
    return { record, extraction };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "抽取失败";
    record = await db.quoteCostImport.update({ where: { id: record.id }, data: { status: "FAILED", errorMessage: message } });
    await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_FAILED, importId: record.id, after: { message } });
    return { record, extraction: null };
  }
}

export async function updateImportReview(input: { importId: string; quoteId: string; projectId: string; orgId: string; userId: string; patch: unknown }): Promise<ImportRecord> {
  const record = await getImport(input);
  if (!(IMPORT_EDITABLE_STATUSES as readonly string[]).includes(record.status)) throw new QuoteEngineError("IMPORT_NOT_EDITABLE", `状态 ${record.status} 的导入不可编辑`, 409);
  const quote = await getQuote(input.quoteId, input.projectId);
  assertQuoteImportable(quote);
  const patch = importReviewPatchSchema.parse(input.patch);
  const before = new Map(rowsOf(record).map((r) => [r.rowId, r]));
  const confirmed = normalizeCurrency(patch.supplierCurrency ?? null);
  if (patch.supplierCurrency && !confirmed) throw new QuoteEngineError("IMPORT_CURRENCY_INVALID", "供应商币种必须是 3 位 ISO 代码", 400);
  const rows = patch.rows.map((r0) => {
    // B3：显式确认的供应商币种只传播到**未识别**行（不覆盖行级/文档级信号）
    const r = patch.applyToUnresolved && confirmed && !r0.sourceCurrency ? { ...r0, sourceCurrency: confirmed, warnings: r0.warnings.filter((w) => w !== "MISSING_CURRENCY") } : r0;
    const prev = before.get(r.rowId);
    const changed = !prev || JSON.stringify({ ...prev, userEdited: false, confidence: 0, warnings: [] }) !== JSON.stringify({ ...r, userEdited: false, confidence: 0, warnings: [] });
    return { ...r, userEdited: (prev?.userEdited ?? false) || changed };
  });
  const meta = (record.metadataJson as Record<string, unknown>) ?? {};
  const updated = await db.quoteCostImport.update({
    where: { id: record.id },
    data: {
      status: "REVIEW_REQUIRED",
      confirmedAt: null,
      confirmedById: null,
      reviewJson: JSON.parse(JSON.stringify({ rows })) as Prisma.InputJsonValue,
      ...(patch.supplierName !== undefined ? { supplierName: patch.supplierName } : {}),
      ...(patch.quoteDate !== undefined ? { quoteDate: patch.quoteDate ? new Date(patch.quoteDate) : null } : {}),
      metadataJson: { ...meta, ...(patch.supplierCurrency !== undefined ? { supplierCurrency: confirmed, currencyMode: confirmed ? "CONFIRMED" : "AUTO_DETECT" } : {}), unresolvedCurrencyRows: rows.filter((r) => r.include && !r.sourceCurrency).length } as Prisma.InputJsonValue,
    },
  });
  await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_REVIEWED, importId: record.id, after: { rows: rows.length, included: rows.filter((r) => r.include).length, edited: rows.filter((r) => r.userEdited).length } });
  return updated;
}

export async function confirmImport(input: { importId: string; quoteId: string; projectId: string; orgId: string; userId: string }): Promise<ImportRecord> {
  const record = await getImport(input);
  if (record.status !== "REVIEW_REQUIRED") throw new QuoteEngineError("IMPORT_INVALID_STATE", `状态 ${record.status} 不能确认（需 REVIEW_REQUIRED）`, 409);
  const quote = await getQuote(input.quoteId, input.projectId);
  assertQuoteImportable(quote);
  const rows = rowsOf(record);
  const included = rows.filter((r) => r.include);
  if (included.length === 0) throw new QuoteEngineError("IMPORT_NO_ROWS", "没有勾选任何行，无法确认", 422);
  const issues = validateRowsForConfirm(rows);
  if (issues.length > 0) throw new QuoteEngineError("IMPORT_ROWS_INVALID", `仍有 ${issues.length} 处未通过校验（币种 / 类别 / 金额）`, 422, { issues });
  const updated = await db.quoteCostImport.update({ where: { id: record.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: input.userId } });
  await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_CONFIRMED, importId: record.id, after: { included: included.length } });
  return updated;
}

export function rowToCostLinePayload(row: ImportRow, ctx: { importId: string; sortOrder: number; supplierName: string | null; quoteCurrency: string }): CostLinePayload {
  const perUnit = row.suggestedCalculationType === "PER_UNIT";
  // B3：币种必须已解析（行级 / 文档级 / 人工确认）；绝不用报价币种兜底
  const currency = normalizeCurrency(row.sourceCurrency);
  if (!currency) throw new QuoteEngineError("IMPORT_ROWS_INVALID", `行 ${row.rowId} 币种未确认`, 422, { issues: [{ rowId: row.rowId, code: "MISSING_CURRENCY", message: "币种未确认" }] });
  const noteParts = [row.notes ?? "", row.suggestedRate != null ? `源文件比例 ${row.suggestedRate}%（如需按比例计算请改算法）` : ""].filter(Boolean);
  return {
    sortOrder: ctx.sortOrder,
    category: row.suggestedCategory ?? "OTHER",
    subcategory: null,
    description: (row.suggestedDescription || row.sourceDescription).trim().slice(0, 300),
    quantity: perUnit ? row.quantity : null,
    unit: row.unit,
    unitCost: perUnit ? row.unitCost : (row.sourceAmount ?? row.unitCost),
    sourceCurrency: currency,
    // 外币必须人工填汇率（与 Phase 1 B1 fail-closed 一致：引擎 FX_REQUIRED 前不能定价）；本币同样不预填
    fxRate: null,
    fxRateSource: null,
    calculationType: perUnit ? "PER_UNIT" : "FIXED",
    calculationBase: null,
    rate: null,
    duration: null,
    supplierId: null,
    supplierName: ctx.supplierName,
    source: `import:${ctx.importId}`,
    notes: noteParts.join("；") || null,
    included: true,
  };
}

/** 成本行 provenance（与成本行同一 INSERT 写入；不存在事后补写窗口） */
function provenanceOf(row: ImportRow, record: ImportRecord): Prisma.InputJsonValue {
  return { importId: record.id, sourceDocumentId: record.sourceDocumentId, sourceFilename: record.sourceFilename, rowId: row.rowId, sheet: row.evidence.sheet, row: row.evidence.row, cell: row.evidence.cell, pageNumber: row.evidence.pageNumber, unitLabel: row.evidence.unitLabel, snippet: row.evidence.snippet, originalDescription: row.sourceDescription, originalAmount: row.sourceAmount, rawAmountText: row.rawAmountText, sourceCurrency: row.sourceCurrency, supplierName: record.supplierName, quoteDate: record.quoteDate ? record.quoteDate.toISOString().slice(0, 10) : null, extractionVersion: record.extractionVersion, confidence: row.confidence, aiSuggested: row.aiSuggested, userEdited: row.userEdited } as Prisma.InputJsonValue;
}

export type ApplyImportResult = { record: ImportRecord; quote: QuoteRecord; lineIds: string[]; alreadyApplied: boolean; snapshotRefreshed: boolean };

/**
 * Apply（B1：原子 + 幂等 + 防并发）——**一个事务边界**：
 *  1. QuoteCostImport 行 FOR UPDATE（并发 Apply 串行化）→ 重读状态：APPLIED → 直接返回已应用结果（幂等，零重复）；
 *     CONFIRMED（或 allowConfirm 下的 REVIEW_REQUIRED）才继续，否则 IMPORT_INVALID_STATE
 *  2. ProjectQuote 行 FOR UPDATE → 冻结纪律复核（approved/superseded/awarded/cancelled 拒绝）
 *  3. 行级校验（币种 / 类别 / 金额 / 数量）整体通过才写
 *  4. 逐行 INSERT QuoteCostLine（**provenance 同一 INSERT**）；只追加，不替换既有行（既有/并发成本行原样保留）
 *  5. 同一事务把导入置 APPLIED + appliedJson(lineIds)（confirm_apply 时同步写 confirmedAt）
 * 派生快照（summaryJson / calculatedCost）在事务外刷新：失败不影响已提交的财务源行与 APPLIED 状态——
 * 运行时引擎为真相（读路径重算并标 drift），下一次保存/重算自愈；结果以 snapshotRefreshed 显式报告。
 */
export async function applyImport(input: { importId: string; quoteId: string; projectId: string; orgId: string; userId: string; allowConfirm?: boolean; deps?: { failBeforeCommit?: () => Promise<void> | void } }): Promise<ApplyImportResult> {
  const committed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuoteCostImport" WHERE "id" = ${input.importId} FOR UPDATE`;
    const record = await tx.quoteCostImport.findFirst({ where: { id: input.importId, quoteId: input.quoteId, projectId: input.projectId, orgId: input.orgId } });
    if (!record) throw new QuoteEngineError("IMPORT_NOT_FOUND", "导入记录不存在", 404);
    if (record.status === "APPLIED") {
      const lineIds = ((record.appliedJson as { lineIds?: unknown } | null)?.lineIds as string[] | undefined) ?? [];
      return { record, lineIds, alreadyApplied: true };
    }
    const confirming = record.status === "REVIEW_REQUIRED" && input.allowConfirm === true;
    if (record.status !== "CONFIRMED" && !confirming) throw new QuoteEngineError("IMPORT_INVALID_STATE", `状态 ${record.status} 不能应用（需先确认）`, 409);
    await tx.$queryRaw`SELECT "id" FROM "ProjectQuote" WHERE "id" = ${input.quoteId} FOR UPDATE`;
    const quote = await tx.projectQuote.findFirst({ where: { id: input.quoteId, projectId: input.projectId, orgId: input.orgId }, select: { id: true, status: true, currency: true, costLines: { select: { sortOrder: true } } } });
    if (!quote) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
    assertQuoteImportable(quote);
    const rows = rowsOf(record).filter((r) => r.include);
    if (rows.length === 0) throw new QuoteEngineError("IMPORT_NO_ROWS", "没有勾选任何行，无法应用", 422);
    const issues = validateRowsForConfirm(rows);
    if (issues.length > 0) throw new QuoteEngineError("IMPORT_ROWS_INVALID", `仍有 ${issues.length} 处未通过校验（币种 / 类别 / 金额）`, 422, { issues });
    const maxSort = quote.costLines.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    const lineIds: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const p = rowToCostLinePayload(row, { importId: record.id, sortOrder: maxSort + (i + 1) * 10, supplierName: record.supplierName, quoteCurrency: quote.currency });
      const line = await tx.quoteCostLine.create({
        data: {
          quoteId: quote.id, orgId: input.orgId, sortOrder: p.sortOrder, category: p.category, subcategory: p.subcategory ?? null, description: p.description, quantity: D(p.quantity), unit: p.unit ?? null, unitCost: D(p.unitCost),
          sourceCurrency: p.sourceCurrency, fxRate: D(p.fxRate), fxRateSource: p.fxRateSource ?? null, calculationType: p.calculationType, calculationBase: p.calculationBase ?? null, rate: D(p.rate), duration: D(p.duration),
          supplierId: p.supplierId ?? null, supplierName: p.supplierName ?? null, source: p.source ?? null, notes: p.notes ?? null, included: p.included,
          metadata: provenanceOf(row, record),
        },
        select: { id: true },
      });
      lineIds.push(line.id);
    }
    if (input.deps?.failBeforeCommit) await input.deps.failBeforeCommit();
    const now = new Date();
    const done = await tx.quoteCostImport.update({
      where: { id: record.id },
      data: { status: "APPLIED", ...(confirming ? { confirmedAt: now, confirmedById: input.userId } : {}), appliedAt: now, appliedById: input.userId, appliedJson: { lineIds, count: lineIds.length, appliedAt: now.toISOString(), quoteStatusAtApply: quote.status } as Prisma.InputJsonValue },
    });
    return { record: done, lineIds, alreadyApplied: false };
  });
  let snapshotRefreshed = false;
  if (!committed.alreadyApplied) {
    try {
      await snapshotQuote(input.quoteId, input.projectId);
      snapshotRefreshed = true;
    } catch {
      snapshotRefreshed = false;
    }
    await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_APPLIED, importId: committed.record.id, after: { lineIds: committed.lineIds, count: committed.lineIds.length, snapshotRefreshed } });
  }
  return { record: committed.record, quote: await getQuote(input.quoteId, input.projectId), lineIds: committed.lineIds, alreadyApplied: committed.alreadyApplied, snapshotRefreshed };
}

export async function cancelImport(input: { importId: string; quoteId: string; projectId: string; orgId: string; userId: string; reason?: string | null }): Promise<ImportRecord> {
  const record = await getImport(input);
  if (record.status === "APPLIED") throw new QuoteEngineError("IMPORT_INVALID_STATE", "已应用的导入不能取消（请在成本行中删除对应行）", 409);
  if (record.status === "CANCELLED") return record;
  const updated = await db.quoteCostImport.update({ where: { id: record.id }, data: { status: "CANCELLED", metadataJson: { ...((record.metadataJson as Record<string, unknown>) ?? {}), cancelReason: input.reason ?? null } as Prisma.InputJsonValue } });
  await audit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: IMPORT_AUDIT_ACTIONS.QUOTE_IMPORT_CANCELLED, importId: record.id, before: { status: record.status }, after: { reason: input.reason ?? null } });
  return updated;
}

/** 列表/详情序列化（内部视图；含供应商名与置信度——客户视图绝不暴露） */
export function serializeImport(r: ImportRecord, opts: { withRows: boolean }) {
  const meta = (r.metadataJson as Record<string, unknown>) ?? {};
  return {
    id: r.id, quoteId: r.quoteId, status: r.status, sourceType: r.sourceType, sourceFilename: r.sourceFilename, sourceDocumentId: r.sourceDocumentId, contentHash: r.contentHash,
    supplierName: r.supplierName, quoteDate: r.quoteDate ? r.quoteDate.toISOString().slice(0, 10) : null, extractionVersion: r.extractionVersion, errorMessage: r.errorMessage,
    notes: (meta.notes as string[] | undefined) ?? [], detectedCurrency: (meta.detectedCurrency as string | null | undefined) ?? null, supplierCurrency: (meta.supplierCurrency as string | null | undefined) ?? null, currencyMode: (meta.currencyMode as string | undefined) ?? "AUTO_DETECT", unresolvedCurrencyRows: (meta.unresolvedCurrencyRows as number | undefined) ?? rowsOf(r).filter((x) => x.include && !x.sourceCurrency).length, reimportOf: (meta.reimportOf as string | null | undefined) ?? null,
    rowCount: (meta.rowCount as number | undefined) ?? null, aiUpdated: (meta.aiUpdated as number | undefined) ?? 0, applied: (r.appliedJson as { lineIds?: string[]; count?: number } | null) ?? null,
    reconciliation: (meta.reconciliation as unknown) ?? null, profitRowsExcluded: (meta.profitRowsExcluded as number | undefined) ?? 0, ambiguousAmountRows: (meta.ambiguousAmountRows as number | undefined) ?? 0,
    confirmedAt: r.confirmedAt, appliedAt: r.appliedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    ...(opts.withRows ? { rows: rowsOf(r) } : {}),
  };
}
