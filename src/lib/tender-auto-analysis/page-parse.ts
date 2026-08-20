/**
 * Phase 1.1 — 页级 PDF 解析（仅 unpdf，不引入第二引擎）
 */

import { db } from "@/lib/db";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { PARSE_VERSION } from "./constants";
import { sha256Content } from "./hash";
import {
  buildBlockUnits,
  buildSheetUnits,
  type DocumentUnit,
} from "./document-units";

/** 与 legacy parse-content 对齐的全文存储上限 */
export const MAX_CONTENT_TEXT_CHARS = 200_000;

/**
 * 单份 PDF 最大**解析**页数（观察期包4：80 → 400，与整包上限对齐）。
 *
 * 这是解析/落库层的容量护栏（阻止超大文件撑爆 DB/serverless），
 * 不是分析口径：包分析（legacy 管线）另有单文件上限见下。
 * 81–400 页文件解析放行后由 Workforce 管线按页级窗口纳入分析
 * （可续跑、页级读取，无 200k 全文截断问题）。
 */
export const MAX_PDF_PAGES = 400;

/**
 * 包分析（legacy tender-auto-analysis 管线）的单文件页数上限。
 *
 * legacy 管线读 200k 字符截断的整文 contentText，且 EXTRACT_FACTS 单步
 * 必须塞进 300s serverless 预算、无中途 checkpoint——大文件在这条管线上
 * 只有「静默截断」或「超时烧重试」两种结局，因此守住 80 页不放。
 * 超限文件：入队选择时跳过（coverage 显式给原因），由 Workforce 管线纳入。
 */
export const PACKAGE_ANALYSIS_MAX_PDF_PAGES = 80;

/** trim 后字符数低于此阈值视为近空页，标记 OCR_REQUIRED */
export const NEAR_EMPTY_PAGE_CHARS = 16;

export const EXTRACTION_METHOD_UNPDF = "unpdf" as const;
/** 非 PDF 单元的抽取方式标记（与 PDF 页级行区分，便于排障与统计） */
export const EXTRACTION_METHOD_SHEET = "sheet-csv" as const;
export const EXTRACTION_METHOD_BLOCK = "text-block" as const;

export type PageParseStatus = "done" | "OCR_REQUIRED" | "empty" | "failed";

export type ExtractedPdfPage = {
  pageNumber: number;
  contentText: string;
  charCount: number;
  parseStatus: PageParseStatus;
  extractionMethod: typeof EXTRACTION_METHOD_UNPDF;
};

export type ExtractPdfPagesResult = {
  totalPages: number;
  pages: ExtractedPdfPage[];
};

export type ParseDocumentPagesResult =
  | {
      ok: true;
      documentId: string;
      pageCount: number | null;
      parseStatus: "done";
      contentHash: string;
    }
  | {
      ok: false;
      documentId: string;
      parseStatus: "failed";
      error: string;
    };

function classifyPageText(raw: string): {
  contentText: string;
  charCount: number;
  parseStatus: PageParseStatus;
} {
  const contentText = typeof raw === "string" ? raw : String(raw ?? "");
  const trimmed = contentText.trim();
  const charCount = trimmed.length;
  if (charCount === 0) {
    return { contentText: "", charCount: 0, parseStatus: "OCR_REQUIRED" };
  }
  if (charCount < NEAR_EMPTY_PAGE_CHARS) {
    return {
      contentText: trimmed,
      charCount,
      parseStatus: "OCR_REQUIRED",
    };
  }
  return { contentText, charCount: contentText.length, parseStatus: "done" };
}

function sanitizeParseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

/**
 * 从 PDF buffer 按页提取文本（mergePages: false）。
 * pageNumber 为 1-based。
 */
export async function extractPdfPagesFromBuffer(
  buffer: Buffer,
): Promise<ExtractPdfPagesResult> {
  const { extractText } = await import("unpdf");
  const { totalPages, text } = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  const pageTexts = Array.isArray(text) ? text : [String(text ?? "")];
  const pages: ExtractedPdfPage[] = pageTexts.map((pageText, idx) => {
    const classified = classifyPageText(pageText);
    return {
      pageNumber: idx + 1,
      contentText: classified.contentText,
      charCount: classified.charCount,
      parseStatus: classified.parseStatus,
      extractionMethod: EXTRACTION_METHOD_UNPDF,
    };
  });
  return {
    totalPages: typeof totalPages === "number" ? totalPages : pages.length,
    pages,
  };
}

/**
 * 非 PDF → 可引用单元（sheet / block）。
 * 与 PDF 的页级行同构落库，使 V2 的「引用必须可核验」在非 PDF 上同样成立。
 */
export async function extractNonPdfUnits(
  buffer: Buffer,
  fileType: string,
): Promise<{ units: DocumentUnit[] } | { error: string }> {
  const type = fileType.toLowerCase();
  try {
    if (type === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { units: buildBlockUnits(result.value?.trim() || "") };
    }
    if (type === "xls" || type === "xlsx") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheets: { name: string; csv: string }[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) sheets.push({ name, csv: csv.trim() });
      }
      return { units: buildSheetUnits(sheets) };
    }
    if (type === "csv") {
      return {
        units: buildSheetUnits([
          { name: "CSV", csv: buffer.toString("utf-8").trim() },
        ]),
      };
    }
    if (type === "txt") {
      return { units: buildBlockUnits(buffer.toString("utf-8").trim()) };
    }
    // 旧二进制 .doc 无可靠文本抽取器 → 明确不支持（不静默产出空单元）
    return { error: `不支持的文件格式: ${fileType}` };
  } catch (e) {
    return { error: sanitizeParseError(e) };
  }
}

function joinPagesForDocument(pages: ExtractedPdfPage[]): string {
  return pages
    .map((p) => p.contentText)
    .filter((t) => t.length > 0)
    .join("\n\n")
    .slice(0, MAX_CONTENT_TEXT_CHARS);
}

/**
 * 读取 Blob → 页级解析 → 写入 ProjectDocumentPage + 更新 ProjectDocument。
 * 失败时写入 parseStatus=failed，绝不向调用方抛出未捕获异常。
 */
export async function parseDocumentPagesAndStore(
  documentId: string,
  opts?: { contentHash?: string },
): Promise<ParseDocumentPagesResult> {
  try {
    const doc = await db.projectDocument.findUnique({
      where: { id: documentId },
      select: { id: true, blobUrl: true, fileType: true, contentHash: true },
    });
    if (!doc || !doc.blobUrl) {
      const error = "文档不存在或缺少 blobUrl";
      await db.projectDocument
        .update({
          where: { id: documentId },
          data: { parseStatus: "failed", parseError: error },
        })
        .catch(() => undefined);
      return { ok: false, documentId, parseStatus: "failed", error };
    }

    await db.projectDocument.update({
      where: { id: documentId },
      data: { parseStatus: "parsing", parseError: null },
    });

    const blob = await readBlobBuffer(doc.blobUrl);
    if (!blob) {
      const error = "Blob 下载失败：对象不存在或不可读";
      await db.projectDocument.update({
        where: { id: documentId },
        data: { parseStatus: "failed", parseError: error },
      });
      return { ok: false, documentId, parseStatus: "failed", error };
    }
    if (blob.buffer.length === 0) {
      const error = "下载的文件内容为空";
      await db.projectDocument.update({
        where: { id: documentId },
        data: { parseStatus: "failed", parseError: error },
      });
      return { ok: false, documentId, parseStatus: "failed", error };
    }

    const buffer = blob.buffer;
    const contentHash =
      opts?.contentHash?.trim() ||
      doc.contentHash?.trim() ||
      sha256Content(buffer);

    const fileType = doc.fileType.toLowerCase();

    if (fileType === "pdf") {
      const extracted = await extractPdfPagesFromBuffer(buffer);
      if (extracted.totalPages > MAX_PDF_PAGES) {
        const error = `PDF 页数超过上限（${extracted.totalPages} > ${MAX_PDF_PAGES}）`;
        await db.projectDocument.update({
          where: { id: documentId },
          data: {
            parseStatus: "failed",
            parseError: error,
            parseVersion: PARSE_VERSION,
            contentHash,
            pageCount: extracted.totalPages,
          },
        });
        return { ok: false, documentId, parseStatus: "failed", error };
      }
      const contentText = joinPagesForDocument(extracted.pages) || null;

      await db.$transaction(async (tx) => {
        await tx.projectDocumentPage.deleteMany({ where: { documentId } });
        if (extracted.pages.length > 0) {
          await tx.projectDocumentPage.createMany({
            data: extracted.pages.map((p) => ({
              documentId,
              pageNumber: p.pageNumber,
              contentText: p.contentText,
              charCount: p.charCount,
              extractionMethod: p.extractionMethod,
              parseStatus: p.parseStatus,
            })),
          });
        }
        await tx.projectDocument.update({
          where: { id: documentId },
          data: {
            contentText,
            pageCount: extracted.totalPages,
            parseStatus: "done",
            parseError: null,
            parseVersion: PARSE_VERSION,
            contentHash,
          },
        });
      });

      return {
        ok: true,
        documentId,
        pageCount: extracted.totalPages,
        parseStatus: "done",
        contentHash,
      };
    }

    // 非 PDF：切成**真实存在**的可引用单元（sheet / block），与 PDF 页级行同构落库。
    // 单元序号写进 pageNumber，但 unitKind≠page + unitLabel 保证展示层不会谎称"第 N 页"。
    const nonPdf = await extractNonPdfUnits(buffer, fileType);
    if ("error" in nonPdf) {
      await db.projectDocument.update({
        where: { id: documentId },
        data: {
          parseStatus: "failed",
          parseError: nonPdf.error,
          parseVersion: PARSE_VERSION,
          contentHash,
          pageCount: null,
        },
      });
      return {
        ok: false,
        documentId,
        parseStatus: "failed",
        error: nonPdf.error,
      };
    }

    const units = nonPdf.units;
    const contentText =
      units
        .map((u) => u.contentText)
        .join("\n\n")
        .slice(0, MAX_CONTENT_TEXT_CHARS) || null;

    await db.$transaction(async (tx) => {
      await tx.projectDocumentPage.deleteMany({ where: { documentId } });
      if (units.length > 0) {
        await tx.projectDocumentPage.createMany({
          data: units.map((u) => ({
            documentId,
            pageNumber: u.unitNumber,
            contentText: u.contentText,
            charCount: u.charCount,
            extractionMethod:
              u.unitKind === "sheet" ? EXTRACTION_METHOD_SHEET : EXTRACTION_METHOD_BLOCK,
            parseStatus: u.parseStatus === "done" ? "done" : "empty",
            unitKind: u.unitKind,
            unitLabel: u.unitLabel,
          })),
        });
      }
      await tx.projectDocument.update({
        where: { id: documentId },
        data: {
          contentText,
          // 非 PDF 的 pageCount = 可引用单元数（不是页数）；展示层按 unitKind 区分措辞
          pageCount: units.length > 0 ? units.length : null,
          parseStatus: "done",
          parseError: null,
          parseVersion: PARSE_VERSION,
          contentHash,
        },
      });
    });

    return {
      ok: true,
      documentId,
      pageCount: units.length > 0 ? units.length : null,
      parseStatus: "done",
      contentHash,
    };
  } catch (e) {
    const error = sanitizeParseError(e);
    console.error(`[TenderPageParse] ${documentId} 解析异常:`, error);
    try {
      await db.projectDocument.update({
        where: { id: documentId },
        data: { parseStatus: "failed", parseError: error },
      });
    } catch {
      // 二次失败也不抛出
    }
    return { ok: false, documentId, parseStatus: "failed", error };
  }
}
