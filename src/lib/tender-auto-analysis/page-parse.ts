/**
 * Phase 1.1 — 页级 PDF 解析（仅 unpdf，不引入第二引擎）
 */

import { db } from "@/lib/db";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { PARSE_VERSION } from "./constants";
import { sha256Content } from "./hash";

/** 与 legacy parse-content 对齐的全文存储上限 */
export const MAX_CONTENT_TEXT_CHARS = 200_000;

/** trim 后字符数低于此阈值视为近空页，标记 OCR_REQUIRED */
export const NEAR_EMPTY_PAGE_CHARS = 16;

export const EXTRACTION_METHOD_UNPDF = "unpdf" as const;

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

async function extractNonPdfText(
  buffer: Buffer,
  fileType: string,
): Promise<{ text: string } | { error: string }> {
  const type = fileType.toLowerCase();
  try {
    if (type === "doc" || type === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value?.trim() || "" };
    }
    if (type === "xls" || type === "xlsx") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const lines: string[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) {
          lines.push(`[Sheet: ${name}]`);
          lines.push(csv.trim());
        }
      }
      return { text: lines.join("\n") };
    }
    if (type === "csv" || type === "txt") {
      return { text: buffer.toString("utf-8").trim() };
    }
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

    // 非 PDF：走文本解析，不捏造页级行（pageCount = null）
    const nonPdf = await extractNonPdfText(buffer, fileType);
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

    const contentText =
      nonPdf.text.slice(0, MAX_CONTENT_TEXT_CHARS) || null;
    await db.projectDocumentPage.deleteMany({ where: { documentId } });
    await db.projectDocument.update({
      where: { id: documentId },
      data: {
        contentText,
        pageCount: null,
        parseStatus: "done",
        parseError: null,
        parseVersion: PARSE_VERSION,
        contentHash,
      },
    });

    return {
      ok: true,
      documentId,
      pageCount: null,
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
