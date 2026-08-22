/**
 * Customer Quotation PDF（Phase 2 P0）
 *  - 来源对象只能是 CustomerQuoteView（白名单投影）；渲染前双重泄露门（键名模式 + 结构白名单）——命中即拒绝生成（fail-closed）。
 *  - 复用 Chromium 渲染（renderHtmlToPdf）；客户文档不做 HTML 回落：渲染失败 = 生成失败，绝不把 HTML 当 PDF 存库。
 *  - 持久化复用 ProjectGeneratedDocument（docType=customer_quotation，版本绑定 quoteId/quoteVersion/total/generatedAt/generatedBy）+ 镜像 ProjectDocument；
 *    修订后旧 PDF 不覆盖（按 quoteId 标 stale，永不删除）。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { buildCustomerView, customerViewLeaks, customerViewUnexpectedKeys, type CustomerQuoteView } from "./customer-view";
import { CUSTOMER_QUOTE_AUDIT_ACTIONS } from "./customer-quote";
import { getCompanyIdentity } from "./quotation-identity";
import { buildCustomerQuotationHtml } from "./quotation-html";
import { computeForQuote, engineOf, getQuote, QuoteEngineError, QUOTE_AUDIT_TARGET } from "./service";

export const CUSTOMER_QUOTATION_DOC_TYPE = "customer_quotation" as const;

/** 渲染前门：任何内部键 → 拒绝 */
export function assertCustomerViewSafe(view: CustomerQuoteView): void {
  const leaks = [...customerViewLeaks(view), ...customerViewUnexpectedKeys(view)];
  if (leaks.length > 0) throw new QuoteEngineError("CUSTOMER_PDF_INTERNAL_LEAK", `客户 PDF 源对象含内部字段，拒绝生成：${leaks.slice(0, 8).join(", ")}`, 500, { leaks });
}

let logoCache: string | null | undefined;
async function loadLogoDataUrl(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  for (const rel of ["public/brands/sunny.png", "public/logo.png"]) {
    try {
      const buf = await readFile(path.join(process.cwd(), rel));
      if (buf.length > 0) {
        logoCache = `data:image/png;base64,${buf.toString("base64")}`;
        return logoCache;
      }
    } catch {
      /* try next */
    }
  }
  logoCache = null;
  return null;
}

export type CustomerQuotationPdfResult = { id: string; version: number; title: string; fileUrl: string | null; quoteId: string; quoteVersion: number; total: number; currency: string; generatedAt: string; size: number };

export async function buildQuotationViewForQuote(quoteId: string, projectId: string, orgId: string): Promise<CustomerQuoteView> {
  const q = await getQuote(quoteId, projectId);
  if (q.orgId !== orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  const computed = computeForQuote(q);
  const company = await getCompanyIdentity(orgId);
  return buildCustomerView({ quote: q, calc: computed.calc.ok ? computed.calc : null, tiers: computed.standingOffer?.tiers ?? null, tax: engineOf(q).tax ?? null, company });
}

export async function generateCustomerQuotationPdf(input: { quoteId: string; projectId: string; orgId: string; userId: string }): Promise<CustomerQuotationPdfResult> {
  const q = await getQuote(input.quoteId, input.projectId);
  if (q.orgId !== input.orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  const view = await buildQuotationViewForQuote(input.quoteId, input.projectId, input.orgId);
  assertCustomerViewSafe(view);
  if (view.lines.length === 0) throw new QuoteEngineError("CUSTOMER_QUOTE_EMPTY", "客户报价没有任何公开行，无法生成 PDF", 422);
  const generatedAt = new Date().toISOString();
  const html = buildCustomerQuotationHtml(view, { logoDataUrl: await loadLogoDataUrl(), generatedAt });
  let pdf: Buffer;
  try {
    const { renderHtmlToPdf } = await import("@/lib/pdf/html-to-pdf");
    pdf = await renderHtmlToPdf(html);
  } catch (e) {
    throw new QuoteEngineError("PDF_RENDER_FAILED", `PDF 渲染失败（客户文档不回落 HTML）：${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`, 500);
  }
  const project = await db.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true } });
  if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const version = (await db.projectGeneratedDocument.count({ where: { projectId: input.projectId, docType: CUSTOMER_QUOTATION_DOC_TYPE } })) + 1;
  const blob = await putPrivateBlob({ pathname: `projects/${input.projectId}/generated/customer-quotation-${q.id}-v${q.version}-${Date.now()}.pdf`, body: pdf, contentType: "application/pdf" });
  const title = `Quotation ${view.quoteNumber ?? q.id.slice(-6)} ${view.header.revision} · PDF #${version}`;
  const meta = { docType: CUSTOMER_QUOTATION_DOC_TYPE, version, quoteId: q.id, quoteVersion: q.version, quoteNumber: view.quoteNumber, quoteStatus: q.status, total: view.total, subtotal: view.subtotal, currency: view.currency, lines: view.lines.length, generatedAt, generatedBy: input.userId, renderMode: "chromium_pdf", size: pdf.length, immutable: true };
  // 同一 quoteId 的旧 PDF 标 stale（不覆盖、不删除）；其它版本报价的 PDF 不动
  const older = await db.projectGeneratedDocument.findMany({ where: { projectId: input.projectId, docType: CUSTOMER_QUOTATION_DOC_TYPE, stale: false }, select: { id: true, metaJson: true } });
  const staleIds = older.filter((d) => { try { return (JSON.parse(d.metaJson ?? "{}") as { quoteId?: string }).quoteId === q.id; } catch { return false; } }).map((d) => d.id);
  const row = await db.$transaction(async (tx) => {
    if (staleIds.length > 0) await tx.projectGeneratedDocument.updateMany({ where: { id: { in: staleIds } }, data: { stale: true } });
    const created = await tx.projectGeneratedDocument.create({ data: { orgId: input.orgId, projectId: input.projectId, docType: CUSTOMER_QUOTATION_DOC_TYPE, version, title, blobUrl: blob.proxyUrl, fileUrl: blob.proxyUrl, metaJson: JSON.stringify(meta), stale: false, createdById: input.userId } });
    await tx.projectDocument.create({ data: { projectId: input.projectId, title, url: blob.proxyUrl, blobUrl: blob.proxyUrl, fileType: "pdf", fileSize: pdf.length, parseStatus: "done", source: "generated_customer_quotation", uploadedById: input.userId } });
    return created;
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: CUSTOMER_QUOTE_AUDIT_ACTIONS.CUSTOMER_QUOTE_PDF_GENERATED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { documentId: row.id, pdfVersion: version, quoteVersion: q.version, total: view.total, currency: view.currency, size: pdf.length } }).catch(() => undefined);
  return { id: row.id, version, title, fileUrl: blob.proxyUrl, quoteId: q.id, quoteVersion: q.version, total: view.total, currency: view.currency, generatedAt, size: pdf.length };
}

export async function listCustomerQuotationPdfs(input: { quoteId: string; projectId: string; orgId: string }): Promise<Array<{ id: string; version: number; title: string; fileUrl: string | null; stale: boolean; createdAt: Date; meta: Record<string, unknown> }>> {
  const docs = await db.projectGeneratedDocument.findMany({ where: { projectId: input.projectId, orgId: input.orgId, docType: CUSTOMER_QUOTATION_DOC_TYPE }, orderBy: { createdAt: "desc" }, take: 50 });
  return docs
    .map((d) => ({ d, meta: (() => { try { return JSON.parse(d.metaJson ?? "{}") as Record<string, unknown>; } catch { return {}; } })() }))
    .filter(({ meta }) => meta.quoteId === input.quoteId)
    .map(({ d, meta }) => ({ id: d.id, version: d.version, title: d.title, fileUrl: d.fileUrl, stale: d.stale, createdAt: d.createdAt, meta: { quoteVersion: meta.quoteVersion, total: meta.total, currency: meta.currency, generatedAt: meta.generatedAt, generatedBy: meta.generatedBy, lines: meta.lines } }));
}

/** 内部字段名单（测试/探针用）：这些词绝不能出现在客户 PDF 源对象的键里 */
export const CUSTOMER_PDF_FORBIDDEN_KEYS = ["supplierName", "supplierCost", "internalCost", "commission", "grossProfit", "grossMargin", "markup", "internalNotes", "landedCost", "sourcing", "breakdown", "costLines", "estimatedCost", "fxRate", "importId", "confidence"] as const;
export type PdfSafeSource = Prisma.JsonObject;
