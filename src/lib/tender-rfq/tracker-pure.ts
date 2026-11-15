/**
 * T-2 询价追踪页（纯函数）
 *
 * - nextChaseOutlook：系统下一步做什么、哪天——只读 chase-pure 导出的函数与常量反推，测试用 decideChases 逐例对照
 *   （在 at 时刻扫描起草 / 标未响应，at − 1ms 时还不到）。不改任何判定。
 * - trackerRowView / classifyNeedsAction / trackerSummary：每行的文案、「需要我处理」分类、顶部计数与 /bids 汇总卡（只有计数）。
 * - quoteCellView：报价列。落地价与「最便宜」直接取比价矩阵的行，不自己换汇、不自己排序。
 */

import { CHASE_MAX, chaseSlot, currentMissingFields, deadlinePassed, type ChaseItemSnapshot } from "./chase-pure";
import type { CompareRow } from "./compare";
import type { InboundMissingField } from "./inbound-contract";
import { monthDay } from "./web-entry-pure";

const DAY = 86_400_000;

export type ChaseOutlook =
  | { kind: "chase_on"; at: Date; chaseKind: "no_reply" | "missing_fields" }
  | { kind: "no_response_on"; at: Date }
  | { kind: "card_pending" }
  | { kind: "rejected_wait"; noResponseAt: Date | null }
  | { kind: "max_reached_wait"; at: Date }
  | { kind: "asked_wait" }
  | { kind: "manual_only"; noResponseAt: Date | null }
  | { kind: "done" };

export type OutlookInput = Pick<ChaseItemSnapshot, "itemId" | "status" | "sentAt" | "threadId" | "chases" | "cards" | "quote">;

/** 与 decideNoResponse 同一条件的最早时刻：等满 chaseAfterDays，且（催满两次或回复截止已过） */
function noResponseAt(lastContact: Date, nudges: number, days: number, replyBy: Date | null): Date | null {
  const waited = lastContact.getTime() + days * DAY;
  if (nudges >= CHASE_MAX) return new Date(waited);
  if (!replyBy) return null;
  return new Date(Math.max(waited, replyBy.getTime() + DAY));
}

function slotState(cards: OutlookInput["cards"], slot: string): "live" | "rejected" | null {
  const mine = cards.filter((c) => c.slot === slot);
  if (mine.some((c) => c.state === "live")) return "live";
  if (mine.some((c) => c.state === "rejected")) return "rejected";
  return null;
}

export function nextChaseOutlook(item: OutlookInput, ctx: { now: Date; chaseAfterDays: number; replyBy: Date | null }): ChaseOutlook {
  const { now, chaseAfterDays: days, replyBy } = ctx;

  if (item.status === "sent") {
    if (!item.sentAt) return { kind: "done" };
    const nudges = item.chases.filter((c) => c.kind === "no_reply");
    const last = nudges.length ? nudges[nudges.length - 1].at : item.sentAt;
    const nra = noResponseAt(last, nudges.length, days, replyBy);
    if (!item.threadId) return { kind: "manual_only", noResponseAt: nra };
    if (nudges.length >= CHASE_MAX) return { kind: "max_reached_wait", at: nra! };
    const slot = slotState(item.cards, chaseSlot(item.itemId, "no_reply", nudges.length + 1));
    if (slot === "live") return { kind: "card_pending" };
    if (slot === "rejected") return { kind: "rejected_wait", noResponseAt: nra };
    const chaseAt = new Date(last.getTime() + days * DAY);
    // 到期那一刻回复截止已过：扫描不再催，改标未响应
    if (deadlinePassed(replyBy, chaseAt)) return { kind: "no_response_on", at: nra! };
    return { kind: "chase_on", at: chaseAt, chaseKind: "no_reply" };
  }

  if (item.status === "replied" || item.status === "quoted") {
    const missing = currentMissingFields(item.quote, { quoted: item.status === "quoted" });
    if (missing.length === 0) return { kind: "done" };
    if (item.chases.some((c) => c.kind === "missing_fields")) return { kind: "asked_wait" };
    if (!item.threadId) return { kind: "manual_only", noResponseAt: null };
    const slot = slotState(item.cards, chaseSlot(item.itemId, "missing_fields", 1));
    if (slot === "live") return { kind: "card_pending" };
    if (slot === "rejected") return { kind: "rejected_wait", noResponseAt: null };
    // 追问缺字段不看天数：下一次扫描就起草
    return { kind: "chase_on", at: now, chaseKind: "missing_fields" };
  }

  return { kind: "done" };
}

/* ---------------------------------- 文案 ---------------------------------- */

export const STATUS_LABELS: Record<string, string> = {
  sent: "等回复",
  replied: "已回信",
  quoted: "已报价",
  no_response: "未响应",
};

export const MISSING_FIELD_LABELS: Record<InboundMissingField, string> = {
  price: "单价",
  currency: "币种",
  deliveryDays: "交期",
  validUntil: "有效期",
  moq: "起订量",
  incoterm: "贸易条款",
};

/** 时间点按组织时区取月-日（不用 monthDay：它会把恰好 UTC 零点的时间点当成纯日期） */
export function zonedMonthDay(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")}`;
}

export function outlookText(o: ChaseOutlook, timeZone: string, now: Date): string | null {
  const day = (d: Date) => (d.getTime() <= now.getTime() ? "今天" : zonedMonthDay(d, timeZone));
  switch (o.kind) {
    case "chase_on":
      return o.chaseKind === "missing_fields" ? "下次扫描时自动追问缺的字段" : `下次自动催 ${day(o.at)}`;
    case "no_response_on":
      return `将于 ${day(o.at)} 标未响应`;
    case "card_pending":
      return "催单卡待批";
    case "rejected_wait":
      return o.noResponseAt ? `催单被驳回，系统不再自动催；将于 ${day(o.noResponseAt)} 标未响应` : "催单被驳回，系统不再自动催";
    case "max_reached_wait":
      return `已催满 ${CHASE_MAX} 次；将于 ${day(o.at)} 标未响应`;
    case "asked_wait":
      return "已追问过缺的字段，等供应商回复";
    case "manual_only":
      return o.noResponseAt ? `手工联系，系统不会自动催；将于 ${day(o.noResponseAt)} 标未响应` : "手工联系，系统不会自动催";
    case "done":
      return null;
  }
}

export type NeedsAction = "chase_card_pending" | "reply_no_quote" | "missing_fields" | "past_reply_by";

export const NEEDS_ACTION_LABELS: Record<NeedsAction, string> = {
  chase_card_pending: "催单卡待批",
  reply_no_quote: "回信没报价",
  missing_fields: "报价缺字段",
  past_reply_by: "过了回复截止还没回",
};

export type ClassifyInput = { status: string; outlook: ChaseOutlook; missing: InboundMissingField[]; replyBy: Date | null; now: Date };

/** 需要我动手的四类（按这个顺序取第一类）；其余为 null */
export function classifyNeedsAction(r: ClassifyInput): NeedsAction | null {
  if (r.outlook.kind === "card_pending") return "chase_card_pending";
  if (r.status === "replied" && r.missing.includes("price")) return "reply_no_quote";
  if ((r.status === "replied" || r.status === "quoted") && r.missing.length > 0) return "missing_fields";
  if (r.status === "sent" && deadlinePassed(r.replyBy, r.now)) return "past_reply_by";
  return null;
}

export type TrackerRowInput = {
  status: string;
  sentAt: Date | null;
  noReplyChases: number;
  outlook: ChaseOutlook;
  missing: InboundMissingField[];
  replyBy: Date | null;
  hasThread: boolean;
};

export type TrackerRowView = {
  statusLabel: string;
  sentText: string | null;
  chasedText: string | null;
  outlookText: string | null;
  missingText: string | null;
  replyByText: string | null;
};

export function trackerRowView(r: TrackerRowInput, timeZone: string, now: Date): TrackerRowView {
  const replyDay = r.replyBy ? monthDay(r.replyBy, timeZone) : null;
  return {
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    sentText: r.sentAt ? `发出于 ${zonedMonthDay(r.sentAt, timeZone)}` : null,
    chasedText: r.noReplyChases > 0 ? `已催 ${r.noReplyChases} 次` : null,
    outlookText: outlookText(r.outlook, timeZone, now),
    missingText: r.missing.length ? `缺：${r.missing.map((f) => MISSING_FIELD_LABELS[f]).join("、")}` : null,
    replyByText: replyDay ? `回复截止 ${replyDay}` : null,
  };
}

/* ---------------------------------- 计数与汇总卡 ---------------------------------- */

export type TrackerSummary = {
  needsAction: number;
  waiting: number;
  quoted: number;
  noResponse: number;
  pendingCards: number;
  quotedThisWeek: number;
};

export type SummaryRow = { status: string; needsAction: NeedsAction | null; repliedAt: Date | null };

export function trackerSummary(rows: SummaryRow[], now: Date): TrackerSummary {
  const weekAgo = now.getTime() - 7 * DAY;
  return {
    needsAction: rows.filter((r) => r.needsAction != null).length,
    waiting: rows.filter((r) => r.status === "sent").length,
    quoted: rows.filter((r) => r.status === "quoted").length,
    noResponse: rows.filter((r) => r.status === "no_response").length,
    pendingCards: rows.filter((r) => r.needsAction === "chase_card_pending").length,
    quotedThisWeek: rows.filter((r) => r.status === "quoted" && r.repliedAt && r.repliedAt.getTime() >= weekAgo).length,
  };
}

/** /bids 顶部汇总卡：只有计数，不出现金额 */
export function summaryCardText(s: TrackerSummary): string {
  const parts: string[] = [];
  if (s.waiting) parts.push(`${s.waiting} 家等回复`);
  if (s.pendingCards) parts.push(`${s.pendingCards} 张催单待批`);
  if (s.quotedThisWeek) parts.push(`本周 ${s.quotedThisWeek} 家已报价`);
  return parts.length ? `询价追踪：${parts.join(" · ")}` : "询价追踪：没有在途询价";
}

export const EMPTY_TRACKER_ZH = "没有在途询价。去项目里点「问供应商要价」。";

/* ---------------------------------- 报价列 ---------------------------------- */

export type QuoteFields = {
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
  deliveryDays: number | null;
  validUntil: Date | null;
};

export type QuoteCell = {
  quoteText: string | null;
  landedText: string | null;
  cheapest: boolean;
  /** 落地价没给出时，页面给「去比价」链接 */
  needsCompareLink: boolean;
};

const money = (n: number, maxFrac: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });

/**
 * matrixRow：该轮比价矩阵里对上的那一行；matrixLoaded = false 表示这一轮没算矩阵（超过上限），写「请到比价面板查看」。
 * 落地价、最便宜、换算不出的原因都只取 matrixRow，不自己算。
 */
export function quoteCellView(
  q: QuoteFields,
  matrixRow: Pick<CompareRow, "landedCad" | "flags" | "blockers"> | null,
  opts: { matrixLoaded: boolean; timeZone: string },
): QuoteCell {
  const cur = (q.currency ?? "").trim().toUpperCase() || "币种未注明";
  const parts: string[] = [];
  if (q.unitPrice != null) parts.push(`报价 ${cur} ${money(q.unitPrice, 2)} / 件`);
  if (q.totalPrice != null) parts.push(`${q.unitPrice != null ? "总价" : "报价总价"} ${cur} ${money(q.totalPrice, 2)}`);
  if (q.deliveryDays != null) parts.push(`交期 ${q.deliveryDays} 天`);
  if (q.validUntil) parts.push(`有效至 ${monthDay(q.validUntil, opts.timeZone)}`);
  const quoteText = parts.length ? parts.join(" · ") : null;

  if (!opts.matrixLoaded) return { quoteText, landedText: "落地价请到比价面板查看", cheapest: false, needsCompareLink: true };
  if (!matrixRow) return { quoteText, landedText: null, cheapest: false, needsCompareLink: false };
  if (matrixRow.landedCad.total == null) {
    return { quoteText, landedText: `落地价未换算（${matrixRow.blockers[0] ?? "缺换算参数"}）`, cheapest: false, needsCompareLink: true };
  }
  return {
    quoteText,
    landedText: `落地价 CAD ${money(Math.round(matrixRow.landedCad.total), 0)}`,
    cheapest: matrixRow.flags.includes("cheapest"),
    needsCompareLink: false,
  };
}
