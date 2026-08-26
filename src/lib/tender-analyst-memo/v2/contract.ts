/**
 * 分析师备忘录 v2 · 契约（全文多轮推理管线）
 *
 * 形态目标 = GPT 式全文深读备忘录；工程差异 = 每一步可断点续跑、每个数字可回核出处。
 * Pass 1 深读（分块）→ Pass 2 研究（M3 标准 / M4 两跳市场价）→ Pass 3 综合（两段叙事）
 * → Pass 4 数字回核（确定性，非 LLM）。状态存 room.summaryJson.analystMemoV2（零迁移）。
 */

import { z } from "zod";

export const ANALYST_MEMO_V2_VERSION = "tender-analyst-memo/v2" as const;

const zs = (max: number) => z.preprocess((v) => String(v ?? "").slice(0, max), z.string());

/** Pass 1 · 单块阅读笔记（LLM 输出；pageRef 必须是文本中出现的锚点，如 "《Tender》p.21"） */
export const chunkNotesSchema = z.object({
  scopeNotes: z.array(zs(240)).max(10).default([]),
  specNotes: z.array(z.object({ item: zs(120), valueRaw: zs(160), pageRef: zs(60) })).max(24).default([]),
  commercialNotes: z.array(z.object({ topic: zs(60), detailZh: zs(240), pageRef: zs(60) })).max(16).default([]),
  externalRefs: z.array(z.object({ refCode: zs(80), docName: zs(160), sectionRange: zs(80).nullable().optional(), quote: zs(240), pageRef: zs(60) })).max(8).default([]),
  ambiguities: z.array(z.object({ questionZh: zs(240), whyZh: zs(160), pageRef: zs(60) })).max(10).default([]),
  productPhrases: z.array(zs(120)).max(5).default([]),
  riskSignals: z.array(z.object({ riskZh: zs(240), pageRef: zs(60) })).max(10).default([]),
});
export type ChunkNotes = z.infer<typeof chunkNotesSchema>;

/** Pass 3 · 叙事节（bodyMd 支持受限 Markdown：###、**粗体**、- 列表、| 表格 |） */
export const memoSectionsSchema = z.object({
  sections: z.array(z.object({ titleZh: zs(60), bodyMd: zs(6000) })).min(2).max(8),
});
export type MemoSections = z.infer<typeof memoSectionsSchema>;

export type MemoChunkMeta = { index: number; charCount: number; pageSpan: string };

export type MemoResearch = {
  standards: unknown | null;
  market: unknown | null;
};

export type MemoV2State = {
  version: typeof ANALYST_MEMO_V2_VERSION;
  runId: string;
  /** 文档指纹（页数+字符数），源变了自动作废重来 */
  sourceFingerprint: string;
  status: "reading" | "researching" | "synthesizing" | "done";
  chunks: MemoChunkMeta[];
  chunksDone: number;
  notes: ChunkNotes;
  research: MemoResearch | null;
  /** 两段叙事：part1 = 摘要/事实/范围/技术+标准；part2 = 风险/市场/GO-NO-GO/RFI/下一步 */
  sectionsPart1: MemoSections["sections"] | null;
  sectionsPart2: MemoSections["sections"] | null;
  updatedAt: string;
};

export const MEMO_STATE_KEY = "analystMemoV2" as const;

/** 合并多块笔记（保序去重；上限防状态膨胀） */
export function mergeNotes(a: ChunkNotes, b: ChunkNotes): ChunkNotes {
  const uniq = <T>(rows: T[], key: (t: T) => string, cap: number): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of rows) {
      const k = key(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= cap) break;
    }
    return out;
  };
  return {
    scopeNotes: uniq([...a.scopeNotes, ...b.scopeNotes], (x) => x, 24),
    specNotes: uniq([...a.specNotes, ...b.specNotes], (x) => `${x.item}|${x.valueRaw}`, 80),
    commercialNotes: uniq([...a.commercialNotes, ...b.commercialNotes], (x) => `${x.topic}|${x.detailZh.slice(0, 60)}`, 48),
    externalRefs: uniq([...a.externalRefs, ...b.externalRefs], (x) => `${x.docName}|${x.sectionRange ?? x.refCode}`, 16),
    ambiguities: uniq([...a.ambiguities, ...b.ambiguities], (x) => x.questionZh.slice(0, 80), 24),
    productPhrases: uniq([...a.productPhrases, ...b.productPhrases], (x) => x.toLowerCase(), 8),
    riskSignals: uniq([...a.riskSignals, ...b.riskSignals], (x) => x.riskZh.slice(0, 80), 24),
  };
}

export const EMPTY_NOTES: ChunkNotes = { scopeNotes: [], specNotes: [], commercialNotes: [], externalRefs: [], ambiguities: [], productPhrases: [], riskSignals: [] };

/** 分块：页文本 → ≤maxChars 的块，每页带可回核锚点 */
export function chunkPages(
  pages: Array<{ docTitle: string; pageNumber: number; unitLabel: string | null; contentText: string }>,
  maxChars = 22_000,
): Array<{ text: string; meta: MemoChunkMeta }> {
  const chunks: Array<{ text: string; meta: MemoChunkMeta }> = [];
  let buf: string[] = [];
  let size = 0;
  let firstAnchor = "";
  let lastAnchor = "";
  const flush = () => {
    if (buf.length === 0) return;
    chunks.push({ text: buf.join("\n\n"), meta: { index: chunks.length, charCount: size, pageSpan: firstAnchor === lastAnchor ? firstAnchor : `${firstAnchor} → ${lastAnchor}` } });
    buf = [];
    size = 0;
    firstAnchor = "";
  };
  for (const p of pages) {
    const anchor = `《${p.docTitle.slice(0, 60)}》${p.unitLabel ?? `p.${p.pageNumber}`}`;
    const text = `【${anchor}】\n${p.contentText}`;
    if (size > 0 && size + text.length > maxChars) flush();
    if (!firstAnchor) firstAnchor = anchor;
    lastAnchor = anchor;
    buf.push(text);
    size += text.length;
    // 单页超大：独立成块（防止无限膨胀）
    if (size > maxChars) flush();
  }
  flush();
  return chunks;
}

/** Pass 4 · 确定性数字回核：备忘录中的数字串必须能在全文或研究来源里找到 */
export function verifyNumbers(memoText: string, corpus: string): { total: number; unverified: string[] } {
  const nums = [...new Set((memoText.match(/(?:\$|CAD|USD|CNY)?\s?\d[\d,]{2,}(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/[^\d.,%]/g, "").replace(/,/g, "")))].filter((n) => n.replace(/[.%]/g, "").length >= 3);
  const hay = corpus.replace(/,/g, "");
  const unverified = nums.filter((n) => !hay.includes(n.replace(/%$/, "")));
  return { total: nums.length, unverified: unverified.slice(0, 20) };
}

/** 锚点接地：pageRef 必须出现在块文本中（防编造出处）；不接地的行直接丢弃 */
export function groundChunkNotes(chunkText: string, notes: ChunkNotes): ChunkNotes {
  const ok = (ref: string) => ref.length > 0 && chunkText.includes(ref.replace(/^【|】$/g, ""));
  return {
    ...notes,
    specNotes: notes.specNotes.filter((n) => ok(n.pageRef)),
    commercialNotes: notes.commercialNotes.filter((n) => ok(n.pageRef)),
    externalRefs: notes.externalRefs.filter((n) => ok(n.pageRef)),
    ambiguities: notes.ambiguities.filter((n) => ok(n.pageRef)),
    riskSignals: notes.riskSignals.filter((n) => ok(n.pageRef)),
  };
}
