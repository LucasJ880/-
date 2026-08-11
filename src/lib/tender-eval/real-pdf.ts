/**
 * 真实招标 PDF → PageInput[]（本地私有 fixture，永不提交）
 *
 * - 复用生产解析器 extractPdfPagesFromBuffer（unpdf），保证与生产同一解析路径。
 * - PDF 缺失时返回 null（benchmark 对应 variant 记 SKIPPED_NO_LOCAL_FIXTURE），
 *   不得用合成文本顶替真实文件。
 */

import { readFileSync, existsSync } from "node:fs";

import { extractPdfPagesFromBuffer } from "@/lib/tender-auto-analysis/page-parse";
import type { PageInput } from "@/lib/tender-auto-analysis/extract/types";

/** 与 scripts/tender-phase11-final-validation.ts 相同的本地私有 fixture 约定 */
export const DEFAULT_RCMP_PDF_PATH =
  "/Users/user/Desktop/青砚-tender-analysis/fixtures/private/M5000-25-3574 - A - RFP - English.pdf";

export type RealPdfLoadResult = {
  pages: PageInput[];
  pageCount: number;
  ocrRequiredPages: number[];
  sourcePath: string;
};

export function resolveRealPdfPath(envVar = "TENDER_FIXTURE_PDF_PATH"): string {
  return process.env[envVar]?.trim() || DEFAULT_RCMP_PDF_PATH;
}

export async function loadRealPdfPages(
  documentId: string,
  pdfPath?: string,
): Promise<RealPdfLoadResult | null> {
  const path = pdfPath ?? resolveRealPdfPath();
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  const parsed = await extractPdfPagesFromBuffer(buffer);
  const pages: PageInput[] = parsed.pages.map((p) => ({
    documentId,
    pageNumber: p.pageNumber,
    contentText: p.contentText,
  }));
  return {
    pages,
    pageCount: parsed.pages.length,
    ocrRequiredPages: parsed.pages
      .filter((p) => p.parseStatus === "OCR_REQUIRED")
      .map((p) => p.pageNumber),
    sourcePath: path,
  };
}
