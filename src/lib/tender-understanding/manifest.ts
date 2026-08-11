/**
 * Document Manifest + 通用结构识别 + Page-aware 窗口切分
 *
 * - Manifest 永远 project-scoped：只描述调用方显式传入的文档集。
 * - 结构识别只认通用形态（PART/SECTION/ANNEX/APPENDIX/ATTACHMENT/ADDENDUM/编号标题），
 *   不得包含任何具体 Tender 的 section 规则。
 * - 窗口切分保留 documentId + pageNumber 一级来源信息；禁止把整包 flatten 丢失页 provenance。
 */

import type {
  AnalyzerDocument,
  AnalyzerInput,
  DocumentManifest,
} from "./contract";

export const V2_PARSE_VERSION = "tender-understanding-v2-manifest@1" as const;

export function buildDocumentManifest(input: AnalyzerInput): DocumentManifest {
  return {
    projectId: input.projectId,
    parseVersion: V2_PARSE_VERSION,
    documents: input.documents.map((d) => ({
      documentId: d.documentId,
      name: d.name,
      type: d.type,
      sourceRole: d.sourceRole,
      pageCount: d.pages.length,
      contentHash: d.contentHash ?? null,
    })),
  };
}

/* ---------------------------------- 通用结构识别 ---------------------------------- */

const HEADING_PATTERNS: RegExp[] = [
  /^\s*(PART|SECTION|ANNEX|APPENDIX|ATTACHMENT|SCHEDULE|ADDENDUM|AMENDMENT)\b[^\n]{0,80}$/im,
  /^\s*\d+(?:\.\d+)*\s+[A-Z][^\n]{3,80}$/m,
  /^\s*[A-Z][A-Z /&-]{6,60}$/m,
];

export function detectPageHeadings(pageText: string): string[] {
  const headings: string[] = [];
  for (const line of pageText.split(/\r?\n/).slice(0, 12)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 90) continue;
    if (HEADING_PATTERNS.some((re) => re.test(trimmed))) {
      headings.push(trimmed.slice(0, 90));
      if (headings.length >= 3) break;
    }
  }
  return headings;
}

/* ---------------------------------- 窗口切分 ---------------------------------- */

export type SectionWindow = {
  windowId: string;
  documentId: string;
  sourceRole: AnalyzerDocument["sourceRole"];
  documentName: string;
  pages: { pageNumber: number; contentText: string }[];
  headings: string[];
};

export type WindowOptions = {
  maxCharsPerWindow?: number;
  maxPagesPerWindow?: number;
  overlapPages?: number;
};

const DEFAULTS: Required<WindowOptions> = {
  maxCharsPerWindow: 9_000,
  maxPagesPerWindow: 4,
  overlapPages: 1,
};

/**
 * Page-aware 切窗：连续页聚合，上限（页数/字符）内尽量在标题页断窗；
 * 相邻窗口重叠 overlapPages 页（跨页条款容错）。
 */
export function buildSectionWindows(
  doc: AnalyzerDocument,
  opts?: WindowOptions,
): SectionWindow[] {
  const { maxCharsPerWindow, maxPagesPerWindow, overlapPages } = {
    ...DEFAULTS,
    ...opts,
  };
  const pages = [...doc.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (pages.length === 0) return [];

  const windows: SectionWindow[] = [];
  let start = 0;
  while (start < pages.length) {
    let end = start;
    let chars = 0;
    while (end < pages.length) {
      const p = pages[end]!;
      const nextChars = chars + p.contentText.length;
      const pageCount = end - start + 1;
      if (pageCount > 1) {
        if (nextChars > maxCharsPerWindow || pageCount > maxPagesPerWindow) break;
        // 标题页优先作为新窗口起点（保持 section 对齐）
        if (detectPageHeadings(p.contentText).length > 0 && chars > maxCharsPerWindow / 2) {
          break;
        }
      }
      chars = nextChars;
      end += 1;
    }
    const slice = pages.slice(start, end);
    windows.push({
      windowId: `${doc.documentId}:w${windows.length + 1}`,
      documentId: doc.documentId,
      sourceRole: doc.sourceRole,
      documentName: doc.name,
      pages: slice.map((p) => ({
        pageNumber: p.pageNumber,
        contentText: p.contentText,
      })),
      headings: slice.flatMap((p) => detectPageHeadings(p.contentText)).slice(0, 6),
    });
    if (end >= pages.length) break;
    start = Math.max(end - overlapPages, start + 1);
  }
  return windows;
}

export function buildAllWindows(
  input: AnalyzerInput,
  opts?: WindowOptions,
): SectionWindow[] {
  return input.documents.flatMap((d) => buildSectionWindows(d, opts));
}
