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
 *
 * FIX-24：供应商可控的文字（附件文件名、证据片段）不能变成回读字段。写入方已中和（inbound-apply.ts），
 * 这里另有五条读取规则，管住本次改动之前已经写进库里的段（见 __tests__/notes-forgery.test.ts）：
 *   R1 行头严格：按原始行匹配（行头里有回车等也不认），时间是 toISOString 的格式且能原样还原
 *      （2026-02-30、24:00 不认），msg 只含字母、数字、-、_；行头之后正文里的 \r、U+2028、U+2029 当空格
 *      （不让整段失效，也不另起一段）；
 *   R2 读到第一个以「附件：」开头的块就停：附件一栏永远在最后，里面只有文件名与系统说明；
 *   R3 遮住成对证据之后还剩「"）」时，看它前后两截：前一截从上一条证据结束处到它，后一截从它到下一个剩下的
 *      「"）」或段尾（中间的成对证据不截断）。前一截里有一个以认得的字段前缀或「附件：」开头的「；」块
 *      （强制项一栏里还有以「，」隔开、形如「编号 满足」的块）——证据把字段夹带了出去——
 *      且后一截像写入方收尾证据之后写的东西（全是空白、有一个这样开头的「；」块、有形如「编号 满足」的「，」块、
 *      或有成对证据），整段不认。证据里合法的英寸记号（「（宽 36"）单价 45；含税」：前一截没有认得的块）
 *      与旧文件名里的引号（「报价单（"含税"）.pdf 已解析」：后一截是普通文字）照常读；一次扫描，行长线性；
 *   R4 第一个「附件：」块及之后出现证据 → 整段不认（写入方从不在那里写证据）；
 *   R5 附件一栏之前认得出的字段按写入顺序、除「其它档」外每种至多一次，违反就整段不认。
 *   整段不认 = 这一段的字段、缺字段与时间都不参与。
 */

import { INBOUND_MISSING_LABEL, type InboundMissingField } from "./inbound-contract";

export type AutoNotesTier = { quantity: number | null; unitPrice: number | null; totalPrice: number | null };
export type AutoNotesAnswer = { requirementCode: string; answer: "满足" | "部分满足" | "不满足" | "未答"; evidence: string | null };

export type ParsedAutoNotes = {
  /** 最新一段 `[auto]` 里的「缺：…」（P1-7 追问用；只看最新一段——后到的回信补齐了就不再缺） */
  lastMissingFields: InboundMissingField[];
  moq: number | null;
  incoterm: string | null;
  tiers: AutoNotesTier[];
  mandatoryAnswers: AutoNotesAnswer[];
  /** 最新一段 `[auto <iso>]` 的时间 */
  lastAutoAt: string | null;
};

const MISSING_BY_LABEL = new Map<string, InboundMissingField>(
  (Object.entries(INBOUND_MISSING_LABEL) as Array<[InboundMissingField, string]>).map(([k, label]) => [label, k]),
);

/** R1：行头按原始行匹配；正文取到行尾（行里没有 \n，正文可能带 \r 等，取出来再换空格） */
const SEGMENT_RE = /^\[auto (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) msg=([A-Za-z0-9_-]+)\] ([\s\S]*)$/;
/** R1：正文里的回车与段落分隔符当空格 */
const IN_LINE_BREAKS = /[\r\u2028\u2029]/g;
/** 证据引号的开头与收尾（与 inbound-apply.ts 的 q() 一致） */
const EVIDENCE_OPENER = "（证据：\"";
const EVIDENCE_CLOSER = '"）';
/** 证据占位符的起止字符（与 R3_SPLIT_RE、restore、strip 里的写法一致） */
const PLACEHOLDER_MARK = "\u0000";
const ATTACHMENT_PREFIX = "附件：";

/**
 * R5：写入方（inbound-apply.ts planInquiryItemUpdate）写事实的先后。第二项 true = 可以出现多次。
 * 依次：单价、总价、其它档、多档未入表的说明、币种、交期、有效期、起订量、贸易条款、强制项答复、强制项未答、
 * 不报价的说明；然后单价 / 总价 / 币种 / 交期 / 有效期五种不一致；最后「缺：」。认不出的块不参与。
 */
export const AUTO_NOTES_WRITE_ORDER: ReadonlyArray<readonly [prefix: string, repeatable: boolean]> = [
  ["单价=", false], ["总价=", false], ["其它档：", true], ["多档报价均不对应", false],
  ["币种=", false], ["交期=", false], ["有效期至=", false], ["起订量=", false], ["贸易条款=", false],
  ["强制项：", false], ["强制项未答：", false], ["供应商明确表示不报价", false],
  ["回信单价 ", false], ["回信报价 ", false], ["回信币种 ", false], ["回信交期 ", false], ["回信有效期 ", false],
  ["缺：", false],
];

/** R1：行头时间能原样还原（JS 会把 2026-02-30 顺延成 3 月 2 日，只看格式不够） */
function isRealInstant(iso: string): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toISOString() === iso;
}

/** R3：「；」块认得的开头（R5 的字段前缀，加上附件一栏） */
const R3_PREFIXES: readonly string[] = [...AUTO_NOTES_WRITE_ORDER.map(([prefix]) => prefix), ATTACHMENT_PREFIX];
/** R3：写入方写的一条强制项答复「编号 答复」（与 ANSWER_RE 同一形状，不带证据） */
const ANSWER_SHAPE_RE = /^\S+ (部分满足|不满足|满足)$/;
/** R3：按「；」「，」、剩下的「"）」与证据占位切开，留下分隔本身 */
const R3_SPLIT_RE = /(；|，|"）|\u0000\d+\u0000)/;

/**
 * R3：证据跳出了引号。一次从左到右扫完（split 的偶数下标是文字，奇数下标是分隔）：
 *   injected —— 从上一条证据结束处到这里，有一个「；」块的开头（跳过开头的空白与证据占位，
 *               与 R5 去掉占位再看开头同口径）是认得的前缀；或当前「强制项：」块里有一个「，」块形如「编号 满足」；
 *   每遇到一个剩下的「"）」，记下当时的 injected，再看它的后一截（到下一个剩下的「"）」或段尾，成对证据不截断）：
 *   全是空白、有认得开头的「；」块、有形如「编号 满足」的「，」块、或有成对证据 = 写入方收尾证据之后的写法
 *   （写入方在证据收尾之后只写「；下一项」「，下一条强制项（证据…）」或什么都不写；攻击方用自己写的
 *   「（证据："」吃掉真正的收尾时，后一截里也会有成对证据）。
 */
function evidenceBrokeOut(masked: string): boolean {
  const parts = masked.split(R3_SPLIT_RE);
  let injected = false;
  let opened = false; // 当前「；」块读到了正文
  let mandatory = false; // 当前「；」块以「强制项：」开头
  let open = false; // 有一个剩下的「"）」，后一截还没看完
  let openInjected = false; // 那个「"）」前一截里有注入
  let closes = false; // 那个「"）」后一截里有认得开头的「；」块、「编号 满足」的「，」块或成对证据
  let blank = true; // 那个「"）」后一截到目前全是空白
  const brokeOut = () => open && openInjected && (closes || blank);
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    if (k % 2 === 0) {
      const s = part.trimStart();
      if (!s) continue;
      blank = false;
      if (!opened) {
        opened = true;
        mandatory = s.startsWith("强制项：");
        if (R3_PREFIXES.some((prefix) => s.startsWith(prefix))) {
          injected = true;
          closes = true;
        }
      }
    } else if (part === "；") {
      blank = false;
      opened = false;
      mandatory = false;
    } else if (part === "，") {
      blank = false;
      if (ANSWER_SHAPE_RE.test(parts[k + 1].trim())) {
        if (mandatory) injected = true;
        closes = true;
      }
      opened = true;
    } else if (part === EVIDENCE_CLOSER) {
      if (brokeOut()) return true;
      open = true;
      openInjected = injected;
      closes = false;
      blank = true;
      opened = true;
    } else {
      // 一条成对证据：前一截从这里重新算；后一截不在这里截断，碰到成对证据也算写入方的写法
      blank = false;
      closes = true;
      injected = false;
    }
  }
  return brokeOut();
}

/** 把成对证据「（证据："…"）」换成占位（从左到右、每条到第一个「"）」为止；一次扫描，行长线性） */
function maskEvidence(body: string, evidence: string[]): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = body.indexOf(EVIDENCE_OPENER, pos);
    if (start < 0) break;
    const end = body.indexOf(EVIDENCE_CLOSER, start + EVIDENCE_OPENER.length);
    if (end < 0) break;
    evidence.push(body.slice(start + EVIDENCE_OPENER.length, end));
    out += `${body.slice(pos, start)}${PLACEHOLDER_MARK}${evidence.length - 1}${PLACEHOLDER_MARK}`;
    pos = end + EVIDENCE_CLOSER.length;
  }
  return out + body.slice(pos);
}

/** R5：块按写入顺序、不重复 */
function inWriteOrder(blocks: string[]): boolean {
  let last = -1;
  const seen = new Set<number>();
  for (const b of blocks) {
    const rank = AUTO_NOTES_WRITE_ORDER.findIndex(([prefix]) => b.startsWith(prefix));
    if (rank < 0) continue;
    if (rank < last || (!AUTO_NOTES_WRITE_ORDER[rank][1] && seen.has(rank))) return false;
    last = rank;
    seen.add(rank);
  }
  return true;
}
const ANSWER_RE = /^(\S+) (部分满足|不满足|满足)(\u0000\d+\u0000)?$/;

const toNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

type SegmentValues = {
  at: string;
  missing: InboundMissingField[];
  moq: number | null;
  incoterm: string | null;
  tiers: AutoNotesTier[];
  answers: AutoNotesAnswer[];
};

/** 返回 null = 这一段整段不认（R3 / R4 / R5） */
function parseSegment(at: string, body: string): SegmentValues | null {
  // 先把证据片段换成占位符：证据是原文摘录，里面可能有"；""，"等分隔符
  const evidence: string[] = [];
  const masked = maskEvidence(body, evidence);
  const restore = (token: string | undefined): string | null => {
    const m = token?.match(/\u0000(\d+)\u0000/);
    return m ? evidence[Number(m[1])] ?? null : null;
  };
  const strip = (s: string) => s.replace(/\u0000\d+\u0000/g, "");

  // R3：证据跳出了引号
  if (evidenceBrokeOut(masked)) return null;
  const facts = masked.split("；").map((raw) => raw.trim());
  // R2：读到第一个「附件：」块就停
  const stop = facts.findIndex((f) => strip(f).startsWith(ATTACHMENT_PREFIX));
  const fieldFacts = stop < 0 ? facts : facts.slice(0, stop);
  // R4：附件一栏及之后出现证据
  if (stop >= 0 && facts.slice(stop).some((f) => f.includes(PLACEHOLDER_MARK))) return null;
  // R5：字段按写入顺序、不重复
  if (!inWriteOrder(fieldFacts.map(strip))) return null;

  const v: SegmentValues = { at, missing: [], moq: null, incoterm: null, tiers: [], answers: [] };
  const chosen: AutoNotesTier = { quantity: null, unitPrice: null, totalPrice: null };

  for (const fact of fieldFacts) {
    let m: RegExpMatchArray | null;
    if ((m = strip(fact).match(/^缺：(.+)$/))) {
      for (const label of m[1].split("、")) {
        const f = MISSING_BY_LABEL.get(label.trim());
        if (f && !v.missing.includes(f)) v.missing.push(f);
      }
    } else if ((m = strip(fact).match(/^起订量=([\d.,]+)$/))) v.moq = toNum(m[1]);
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
    const m = line.match(SEGMENT_RE); // R1：行头按原始行匹配
    if (!m || !isRealInstant(m[1])) continue; // R1
    const seg = parseSegment(m[1], m[3].replace(IN_LINE_BREAKS, " ")); // R1：只对正文换空格
    if (seg) segments.push(seg);
  }
  segments.sort((a, b) => a.at.localeCompare(b.at));

  const result: ParsedAutoNotes = { lastMissingFields: [], moq: null, incoterm: null, tiers: [], mandatoryAnswers: [], lastAutoAt: null };
  const answers = new Map<string, AutoNotesAnswer>();
  for (const s of segments) {
    if (s.moq != null) result.moq = s.moq;
    if (s.incoterm) result.incoterm = s.incoterm;
    if (s.tiers.length) result.tiers = s.tiers;
    for (const a of s.answers) answers.set(a.requirementCode, a);
    result.lastAutoAt = s.at;
    result.lastMissingFields = s.missing;
  }
  result.mandatoryAnswers = [...answers.values()];
  return result;
}
