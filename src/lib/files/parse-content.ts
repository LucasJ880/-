/**
 * 文件内容提取 — 支持 PDF、Word、Excel、纯文本
 *
 * 在服务端调用（API route / agent skill），从 Blob URL 下载文件后提取文本。
 * Vercel Serverless 函数有执行时长限制（Hobby 10s），大文件会被截断。
 */

import { db } from "@/lib/db";

const MAX_TEXT_LENGTH = 200_000; // DB 存储上限，约 20 万字符

type ParseResult = { text: string } | { error: string };

// ── 各格式解析器 ────────────────────────────────────────────────

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy().catch(() => {});
    return { text: result.text?.trim() || "" };
  } catch (e) {
    return { error: `PDF 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function parseWord(buffer: Buffer): Promise<ParseResult> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value?.trim() || "" };
  } catch (e) {
    return { error: `Word 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function parseExcel(buffer: Buffer): Promise<ParseResult> {
  try {
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
  } catch (e) {
    return { error: `Excel 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function parsePlainText(buffer: Buffer): Promise<ParseResult> {
  return { text: buffer.toString("utf-8").trim() };
}

// ── 格式路由 ────────────────────────────────────────────────────

const PARSERS: Record<string, (buf: Buffer) => Promise<ParseResult>> = {
  pdf: parsePdf,
  doc: parseWord,
  docx: parseWord,
  xls: parseExcel,
  xlsx: parseExcel,
  csv: parsePlainText,
  txt: parsePlainText,
};

const PARSABLE_TYPES = new Set(Object.keys(PARSERS));

export function canParseFileType(fileType: string): boolean {
  return PARSABLE_TYPES.has(fileType.toLowerCase());
}

// ── 主入口 ──────────────────────────────────────────────────────

/**
 * 从 Blob URL 下载文件并提取文本内容，结果写入 ProjectDocument.contentText。
 * 调用后 parseStatus 变为 done 或 failed。
 */
export async function parseAndStoreContent(documentId: string): Promise<void> {
  const doc = await db.projectDocument.findUnique({
    where: { id: documentId },
    select: { id: true, blobUrl: true, fileType: true },
  });
  if (!doc || !doc.blobUrl) return;

  const parser = PARSERS[doc.fileType.toLowerCase()];
  if (!parser) {
    await db.projectDocument.update({
      where: { id: documentId },
      data: { parseStatus: "done", contentText: null },
    });
    return;
  }

  await db.projectDocument.update({
    where: { id: documentId },
    data: { parseStatus: "parsing" },
  });

  try {
    const response = await fetch(doc.blobUrl);
    if (!response.ok) throw new Error(`下载失败: ${response.status}`);

    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const result = await parser(buffer);

    if ("error" in result) {
      await db.projectDocument.update({
        where: { id: documentId },
        data: { parseStatus: "failed", parseError: result.error },
      });
      return;
    }

    const text = result.text.slice(0, MAX_TEXT_LENGTH);
    await db.projectDocument.update({
      where: { id: documentId },
      data: { contentText: text || null, parseStatus: "done", parseError: null },
    });
  } catch (e) {
    await db.projectDocument.update({
      where: { id: documentId },
      data: {
        parseStatus: "failed",
        parseError: e instanceof Error ? e.message : String(e),
      },
    });
  }
}
