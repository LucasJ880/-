/**
 * 从内存 Buffer 直接解析文件文本 — 不入库，供 AI 聊天文件上传使用
 */

const MAX_TEXT_LENGTH = 150_000;

type ParseResult = { text: string } | { error: string };

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  try {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(buffer));
    const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
    return { text: joined.trim() };
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

const PARSERS: Record<string, (buf: Buffer) => Promise<ParseResult>> = {
  pdf: parsePdf,
  doc: parseWord,
  docx: parseWord,
  xls: parseExcel,
  xlsx: parseExcel,
  csv: async (buf) => ({ text: buf.toString("utf-8").trim() }),
  txt: async (buf) => ({ text: buf.toString("utf-8").trim() }),
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(PARSERS));

export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

export function isSupportedFileType(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getFileExtension(filename));
}

export async function parseFileBuffer(
  buffer: Buffer,
  filename: string,
): Promise<{ text: string } | { error: string }> {
  const ext = getFileExtension(filename);
  const parser = PARSERS[ext];
  if (!parser) {
    return { error: `不支持的文件格式: .${ext}` };
  }

  const result = await parser(buffer);
  if ("error" in result) return result;

  return { text: result.text.slice(0, MAX_TEXT_LENGTH) };
}
