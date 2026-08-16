/**
 * 非 PDF 文档的「可引用单元」切分（纯函数）
 *
 * 为什么不能直接沿用页码：V2 的证据纪律要求每条结论都能落回**可核验的定位单元**
 * （引用 = documentId + 单元序号 + 逐字原文）。docx/xlsx 没有页的概念，早期实现
 * 因此把它们整体排除（宁可少分析，也不编造"第 3 页"让用户点空）。
 *
 * 本模块给非 PDF 造**真实存在**的单元，而不是假页：
 *   - 表格（xlsx/xls/csv）：一个工作表一个单元；超长表按行区间切，并在每块重复表头，
 *     使每个单元自解释（报价表的行/列语义不会因切块丢失）。
 *   - 文档（docx/txt）：按段落聚合成块，尽量在标题处断开，标签带最近的标题。
 *
 * 单元序号写入 ProjectDocumentPage.pageNumber（1-based），unitKind/unitLabel 同行落库；
 * 展示层用 unitLabel（如 `Sheet「Pricing」· 行 1–40`），绝不显示"第 N 页"。
 */

/** 单文档最大单元数（防超大文件撑爆包与 LLM 预算） */
export const MAX_UNITS_PER_DOCUMENT = 120;
/** 单个单元最大字符数（与 V2 窗口上限 9000 协调，留出 prompt 头部空间） */
export const MAX_CHARS_PER_UNIT = 6_000;
/** 段落块的目标下限：低于它就继续合并，避免碎块把窗口数量炸开 */
export const TARGET_BLOCK_CHARS = 2_400;
/** trim 后低于此长度视为近空单元（与 page-parse 的 NEAR_EMPTY_PAGE_CHARS 一致） */
export const NEAR_EMPTY_UNIT_CHARS = 16;

export type DocumentUnitKind = "sheet" | "block";

export type DocumentUnit = {
  /** 1-based 单元序号，落库到 ProjectDocumentPage.pageNumber */
  unitNumber: number;
  unitKind: DocumentUnitKind;
  /** 人类可读定位标签（展示与引用都用它） */
  unitLabel: string;
  contentText: string;
  charCount: number;
  parseStatus: "done" | "empty";
};

export type SheetInput = { name: string; csv: string };

/** 标题启发式：与 V2 manifest 的通用形态一致，不含任何具体 Tender 规则 */
const HEADING_PATTERNS: RegExp[] = [
  /^\s*(PART|SECTION|ANNEX|APPENDIX|ATTACHMENT|SCHEDULE|ADDENDUM|AMENDMENT|ARTICLE|CLAUSE)\b.{0,80}$/i,
  // 允许「2. PAYMENT TERMS」「4.1 交付」等带尾点/多级编号的条款标题
  /^\s*\d+(?:\.\d+)*\.?\s+\S.{2,80}$/,
  /^\s*[A-Z][A-Z /&()'-]{6,60}$/,
  /^\s*第[一二三四五六七八九十百\d]+[章节条部分].{0,60}$/,
];

export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  return HEADING_PATTERNS.some((re) => re.test(t));
}

function finalize(
  units: Omit<DocumentUnit, "unitNumber" | "charCount" | "parseStatus">[],
): DocumentUnit[] {
  return units.slice(0, MAX_UNITS_PER_DOCUMENT).map((u, i) => {
    const contentText = u.contentText;
    const charCount = contentText.trim().length;
    return {
      unitNumber: i + 1,
      unitKind: u.unitKind,
      unitLabel: u.unitLabel,
      contentText,
      charCount,
      parseStatus: charCount < NEAR_EMPTY_UNIT_CHARS ? "empty" : "done",
    };
  });
}

/* ------------------------------ 表格：按工作表 / 行区间 ------------------------------ */

/**
 * 一个工作表一个单元；超过 MAX_CHARS_PER_UNIT 时按行切块，
 * **每块重复表头行**，保证被单独引用时列含义仍然完整（报价表的关键）。
 */
export function buildSheetUnits(sheets: ReadonlyArray<SheetInput>): DocumentUnit[] {
  const out: Omit<DocumentUnit, "unitNumber" | "charCount" | "parseStatus">[] = [];

  for (const sheet of sheets) {
    const name = sheet.name.trim() || "Sheet";
    const rows = sheet.csv.split(/\r?\n/);
    const nonEmpty = rows.filter((r) => r.trim().length > 0);
    if (nonEmpty.length === 0) continue;

    const header = nonEmpty[0]!;
    const body = nonEmpty.slice(1);

    // 整表能放下 → 单个单元
    if (sheet.csv.length <= MAX_CHARS_PER_UNIT || body.length === 0) {
      out.push({
        unitKind: "sheet",
        unitLabel: `Sheet「${name}」`,
        contentText: `Sheet: ${name}\n${nonEmpty.join("\n")}`,
      });
      continue;
    }

    // 按行切块（1-based 行号以原始非空行计），每块重复表头
    let chunk: string[] = [];
    let chunkStartRow = 2; // 表头是第 1 行
    let chars = header.length;
    const flush = (endRow: number) => {
      if (chunk.length === 0) return;
      out.push({
        unitKind: "sheet",
        unitLabel: `Sheet「${name}」· 行 ${chunkStartRow}–${endRow}`,
        contentText: `Sheet: ${name} (rows ${chunkStartRow}-${endRow})\n${header}\n${chunk.join("\n")}`,
      });
      chunk = [];
      chars = header.length;
    };

    body.forEach((row, idx) => {
      const rowNumber = idx + 2;
      if (chars + row.length > MAX_CHARS_PER_UNIT && chunk.length > 0) {
        flush(rowNumber - 1);
        chunkStartRow = rowNumber;
      }
      chunk.push(row);
      chars += row.length + 1;
    });
    flush(body.length + 1);
  }

  return finalize(out);
}

/* ------------------------------ 文档：按段落块 ------------------------------ */

/**
 * 段落聚合成块：达到目标长度即断开，遇到标题优先在标题前断开；
 * 标签带最近的标题（`§ 4. Payment Terms · 第 3 段`），无标题时退化为段序号。
 */
export function buildBlockUnits(rawText: string): DocumentUnit[] {
  const paragraphs = rawText
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return [];

  const out: Omit<DocumentUnit, "unitNumber" | "charCount" | "parseStatus">[] = [];
  let buffer: string[] = [];
  let chars = 0;
  let currentHeading: string | null = null;
  let headingForBuffer: string | null = null;

  const flush = () => {
    if (buffer.length === 0) return;
    const index = out.length + 1;
    const label = headingForBuffer
      ? `§ ${headingForBuffer.slice(0, 60)} · 第 ${index} 段`
      : `第 ${index} 段`;
    out.push({ unitKind: "block", unitLabel: label, contentText: buffer.join("\n") });
    buffer = [];
    chars = 0;
    headingForBuffer = currentHeading;
  };

  for (const para of paragraphs) {
    const isHeading = looksLikeHeading(para);
    // 标题前断块（且当前块已有实质内容）→ 保持章节对齐
    if (isHeading && chars >= TARGET_BLOCK_CHARS / 2) flush();
    if (isHeading) {
      currentHeading = para;
      if (buffer.length === 0) headingForBuffer = para;
    }

    // 单段就超长 → 该段自成一块（再按硬上限切）
    if (para.length > MAX_CHARS_PER_UNIT) {
      flush();
      for (let i = 0; i < para.length; i += MAX_CHARS_PER_UNIT) {
        buffer = [para.slice(i, i + MAX_CHARS_PER_UNIT)];
        chars = buffer[0]!.length;
        flush();
      }
      continue;
    }

    if (chars + para.length > MAX_CHARS_PER_UNIT) flush();
    buffer.push(para);
    chars += para.length + 1;
    if (chars >= TARGET_BLOCK_CHARS && looksLikeHeading(para) === false) {
      // 达到目标长度就收口，避免块过大导致窗口切分失去意义
      flush();
    }
  }
  flush();

  return finalize(out);
}

/** 单元集合的展示统计（覆盖率/进度文案用） */
export function summarizeUnits(units: ReadonlyArray<DocumentUnit>): {
  total: number;
  usable: number;
  chars: number;
} {
  return {
    total: units.length,
    usable: units.filter((u) => u.parseStatus === "done").length,
    chars: units.reduce((a, u) => a + u.charCount, 0),
  };
}
