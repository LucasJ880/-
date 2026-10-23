/**
 * Tender RFQ（P1-5）— 从 InquiryItem.quoteNotes 的 `[auto …]` 段回读结构化值（纯函数）
 *
 * ⚠ 格式与 inbound-apply.ts（planInquiryItemUpdate 的 notesAppend）一一对应：改一边必须改另一边，
 *   并跑 __tests__/notes-parse.test.ts 的往返测试（写 → 读 → 相等）。
 *
 * 规则：
 *   - 只解析以 `[auto <iso> msg=<id>] ` 开头的行；人工手写的备注一律不碰；
 *   - 多段时每个字段取最新一段里出现的值（后到的回信补充/覆盖先到的；没提到的字段沿用更早的段）；
 *   - 过渡方案：等 schema 升级迁列后删除，本任务不加列。
 */

export type AutoNotesTier = { quantity: number | null; unitPrice: number | null; totalPrice: number | null };
export type AutoNotesAnswer = { requirementCode: string; answer: "满足" | "部分满足" | "不满足" | "未答"; evidence: string | null };

export type ParsedAutoNotes = {
  moq: number | null;
  incoterm: string | null;
  tiers: AutoNotesTier[];
  mandatoryAnswers: AutoNotesAnswer[];
  /** 最新一段 `[auto <iso>]` 的时间 */
  lastAutoAt: string | null;
};

const SEGMENT_RE = /^\[auto (\S+) msg=(\S+)\] (.*)$/;
const EVIDENCE_RE = /（证据："([\s\S]*?)"）/g;
const ANSWER_RE = /^(\S+) (部分满足|不满足|满足)(\u0000\d+\u0000)?$/;

const toNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

type SegmentValues = {
  at: string;
  moq: number | null;
  incoterm: string | null;
  tiers: AutoNotesTier[];
  answers: AutoNotesAnswer[];
};

function parseSegment(at: string, body: string): SegmentValues {
  // 先把证据片段换成占位符：证据是原文摘录，里面可能有"；""，"等分隔符
  const evidence: string[] = [];
  const masked = body.replace(EVIDENCE_RE, (_m, ev: string) => {
    evidence.push(ev);
    return `\u0000${evidence.length - 1}\u0000`;
  });
  const restore = (token: string | undefined): string | null => {
    const m = token?.match(/\u0000(\d+)\u0000/);
    return m ? evidence[Number(m[1])] ?? null : null;
  };
  const strip = (s: string) => s.replace(/\u0000\d+\u0000/g, "");

  const v: SegmentValues = { at, moq: null, incoterm: null, tiers: [], answers: [] };
  const chosen: AutoNotesTier = { quantity: null, unitPrice: null, totalPrice: null };

  for (const raw of masked.split("；")) {
    const fact = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = strip(fact).match(/^起订量=([\d.,]+)$/))) v.moq = toNum(m[1]);
    else if ((m = strip(fact).match(/^贸易条款=([A-Z]{3})$/))) v.incoterm = m[1];
    else if ((m = strip(fact).match(/^(单价|总价)=([\d.,]+)(?:（数量 ([\d.,]+)）)?$/))) {
      if (m[1] === "单价") chosen.unitPrice = toNum(m[2]);
      else chosen.totalPrice = toNum(m[2]);
      if (m[3]) chosen.quantity = toNum(m[3]);
    } else if ((m = strip(fact).match(/^其它档：(.*)$/))) {
      const t = m[1];
      v.tiers.push({
        quantity: toNum(t.match(/数量 ([\d.,]+)/)?.[1]),
        unitPrice: toNum(t.match(/单价 ([\d.,]+)/)?.[1]),
        totalPrice: toNum(t.match(/总价 ([\d.,]+)/)?.[1]),
      });
    } else if (fact.startsWith("强制项未答：")) {
      for (const code of strip(fact).slice("强制项未答：".length).split("、").map((c) => c.trim()).filter(Boolean)) {
        v.answers.push({ requirementCode: code, answer: "未答", evidence: null });
      }
    } else if (fact.startsWith("强制项：")) {
      for (const part of fact.slice("强制项：".length).split("，")) {
        const a = part.trim().match(ANSWER_RE);
        if (a) v.answers.push({ requirementCode: a[1], answer: a[2] as AutoNotesAnswer["answer"], evidence: restore(a[3]) });
      }
    }
  }
  if (chosen.unitPrice != null || chosen.totalPrice != null) v.tiers.unshift(chosen);
  return v;
}

export function parseAutoNotes(quoteNotes: string | null | undefined): ParsedAutoNotes {
  const segments: SegmentValues[] = [];
  for (const line of (quoteNotes ?? "").split("\n")) {
    const m = line.match(SEGMENT_RE);
    if (m) segments.push(parseSegment(m[1], m[3]));
  }
  segments.sort((a, b) => a.at.localeCompare(b.at));

  const result: ParsedAutoNotes = { moq: null, incoterm: null, tiers: [], mandatoryAnswers: [], lastAutoAt: null };
  const answers = new Map<string, AutoNotesAnswer>();
  for (const s of segments) {
    if (s.moq != null) result.moq = s.moq;
    if (s.incoterm) result.incoterm = s.incoterm;
    if (s.tiers.length) result.tiers = s.tiers;
    for (const a of s.answers) answers.set(a.requirementCode, a);
    result.lastAutoAt = s.at;
  }
  result.mandatoryAnswers = [...answers.values()];
  return result;
}
