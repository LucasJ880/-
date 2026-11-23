/**
 * T-2 询价追踪页——纯逻辑（与 decideChases 的一致性、分类、汇总、报价列）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RfqTrackerSummaryCardView } from "@/components/bids/rfq-tracker-summary-card";
import { chaseSlot, decideChases, type ChaseItemSnapshot } from "../chase-pure";
import { buildCompareMatrix, type CompareInput } from "../compare";
import { normalizeQuote, type LandedCostSettings } from "../landed-cost";
import {
  CHASE_SKIP_ZH,
  firstTabWithRows,
  TRACKER_TABS,
  approvableCards,
  chaseSkipZh,
  filterTrackerGroups,
  parseChaseCardKey,
  rowInTab,
  EMPTY_TRACKER_ZH,
  classifyNeedsAction,
  nextChaseOutlook,
  outlookText,
  quoteCellView,
  LANDED_HIDDEN_CELL_ZH,
  LANDED_UNCONFIRMED_CELL_ZH,
  isPermissionHiddenCell,
  trackerLandedHiddenReason,
  summaryCardText,
  trackerRowView,
  trackerSummary,
  zonedMonthDay,
  type ChaseOutlook,
} from "../tracker-pure";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const TZ = "America/Toronto";
const T0 = new Date("2026-11-02T15:00:00Z");
const days = 3;
const at = (d: number, h = 0) => new Date(T0.getTime() + d * DAY + h * 3_600_000);

function snap(o: Partial<ChaseItemSnapshot> = {}): ChaseItemSnapshot {
  return {
    itemId: "it1",
    inquiryId: "inq1",
    projectId: "p1",
    supplierName: "Fixture Supplier",
    status: "sent",
    sentAt: T0,
    threadId: "thread-1",
    chases: [],
    cards: [],
    quote: { unitPrice: null, totalPrice: null, deliveryDays: null, validUntil: null, quoteNotes: null, updatedAt: T0 },
    ...o,
  };
}
const decide = (item: ChaseItemSnapshot, now: Date, replyBy: Date | null) => decideChases({ now, chaseAfterDays: days, replyBy, items: [item] });
const drafted = (item: ChaseItemSnapshot, now: Date, replyBy: Date | null) => decide(item, now, replyBy).drafts.some((d) => d.itemId === item.itemId);
const markedNoResp = (item: ChaseItemSnapshot, now: Date, replyBy: Date | null) => decide(item, now, replyBy).noResponse.includes(item.itemId);
const minus1 = (d: Date) => new Date(d.getTime() - 1);

/** 一致性：页面说「at 起草」→ at 起草、at−1ms 不起草；说「at 标未响应」→ 同理 */
function consistent(name: string, item: ChaseItemSnapshot, replyBy: Date | null, nowForOutlook: Date, expectKind: ChaseOutlook["kind"]) {
  const o = nextChaseOutlook(item, { now: nowForOutlook, chaseAfterDays: days, replyBy });
  ok(`${name}：outlook = ${expectKind}`, o.kind === expectKind, o);
  if (o.kind === "chase_on" && o.chaseKind === "no_reply") {
    ok(`${name}：在 at 时刻扫描起草、at−1ms 不起草`, drafted(item, o.at, replyBy) && !drafted(item, minus1(o.at), replyBy) && decide(item, minus1(o.at), replyBy).skipped.some((s) => s.reason === "not_due"), { at: o.at });
  }
  if (o.kind === "no_response_on" || o.kind === "max_reached_wait") {
    ok(`${name}：在 at 时刻标未响应、at−1ms 不标`, markedNoResp(item, o.at, replyBy) && !markedNoResp(item, minus1(o.at), replyBy), { at: o.at });
  }
  return o;
}

console.log("与 decideChases 的一致性");
{
  // 未催：发出后 3 天催第 1 次
  const o1 = consistent("未催、没有回复截止", snap(), null, at(1), "chase_on");
  ok("未催：at = 发出 + 3 天", o1.kind === "chase_on" && o1.at.getTime() === at(3).getTime());
  // 催过一次：最后一次催 + 3 天催第 2 次
  const once = snap({ chases: [{ index: 1, kind: "no_reply", messageId: "m1", at: at(3) }] });
  const o2 = consistent("催过一次", once, null, at(4), "chase_on");
  ok("催过一次：at = 上次催 + 3 天", o2.kind === "chase_on" && o2.at.getTime() === at(6).getTime());
  // 催满两次：第二次 + 3 天标未响应
  const twice = snap({ chases: [{ index: 1, kind: "no_reply", messageId: "m1", at: at(3) }, { index: 2, kind: "no_reply", messageId: "m2", at: at(6) }] });
  const o3 = consistent("催满两次", twice, null, at(7), "max_reached_wait");
  ok("催满两次：at = 第二次 + 3 天", o3.kind === "max_reached_wait" && o3.at.getTime() === at(9).getTime());
  // 截止已过：回复截止在发出后第 1 天（UTC 零点），到期时截止已过 → 标未响应
  const replyBy = new Date("2026-11-03T00:00:00Z");
  const o4 = consistent("到期时回复截止已过", snap(), replyBy, at(1), "no_response_on");
  ok("截止已过：at = 发出 + 3 天（等满间隔）", o4.kind === "no_response_on" && o4.at.getTime() === at(3).getTime());
  // 截止在到期之后：先催
  const lateReply = new Date("2026-11-20T00:00:00Z");
  consistent("回复截止在到期之后", snap(), lateReply, at(1), "chase_on");
  // 截止在等待期间过：等满之后标未响应（取两者较晚）
  const replyMid = new Date("2026-11-03T00:00:00Z");
  const once2 = snap({ chases: [{ index: 1, kind: "no_reply", messageId: "m1", at: at(1) }] });
  const o5 = consistent("催过一次后截止过了", once2, replyMid, at(2), "no_response_on");
  ok("取「等满间隔」与「截止次日」中较晚的", o5.kind === "no_response_on" && o5.at.getTime() === Math.max(at(4).getTime(), replyMid.getTime() + DAY));
  // 到期了但还没扫描到、此刻回复截止也过了：下一次扫描是标未响应，不是催
  const overdueReply = new Date("2026-11-07T00:00:00Z");
  const nowLate = at(9);
  const od = nextChaseOutlook(snap(), { now: nowLate, chaseAfterDays: days, replyBy: overdueReply });
  ok("到期未扫描、截止已过：写将标未响应（此刻扫描就是标未响应，不起草）", od.kind === "no_response_on" && markedNoResp(snap(), nowLate, overdueReply) && !drafted(snap(), nowLate, overdueReply), od);
  const od2 = nextChaseOutlook(snap(), { now: at(4), chaseAfterDays: days, replyBy: new Date("2026-11-20T00:00:00Z") });
  ok("到期未扫描、截止还没过：仍是催（此刻扫描就会起草）", od2.kind === "chase_on" && drafted(snap(), at(4), new Date("2026-11-20T00:00:00Z")), od2);
  // 有待批卡
  const pend = snap({ cards: [{ slot: chaseSlot("it1", "no_reply", 1), state: "live" }] });
  consistent("有待批卡", pend, null, at(4), "card_pending");
  const pendDl = snap({ cards: [{ slot: chaseSlot("it1", "no_reply", 1), state: "live" }] });
  const dl = new Date("2026-11-06T00:00:00Z");
  const op = nextChaseOutlook(pendDl, { now: at(3, 1), chaseAfterDays: days, replyBy: dl });
  ok("有待批卡且有回复截止：写出不批时哪天标未响应，并与判定一致（待批卡挡不住标未响应）", op.kind === "card_pending" && op.noResponseAt != null && markedNoResp(pendDl, op.noResponseAt, dl) && !markedNoResp(pendDl, minus1(op.noResponseAt), dl), op);
  ok("有待批卡：扫描也不再起草（pending_card）", decide(pend, at(4), null).skipped.some((s) => s.reason === "pending_card"));
  // 被驳回过：扫描不再自动催这一次
  const rej = snap({ cards: [{ slot: chaseSlot("it1", "no_reply", 1), state: "rejected" }] });
  const o6 = consistent("催单被驳回", rej, lateReply, at(4), "rejected_wait");
  ok("被驳回：扫描跳过（rejected_card）；写出将标未响应的日期", decide(rej, at(4), lateReply).skipped.some((s) => s.reason === "rejected_card") && o6.kind === "rejected_wait" && o6.noResponseAt != null && markedNoResp(rej, o6.noResponseAt, lateReply) && !markedNoResp(rej, minus1(o6.noResponseAt), lateReply));
  // 过期的卡：可以重起草
  const dead = snap({ cards: [{ slot: chaseSlot("it1", "no_reply", 1), state: "dead" }] });
  consistent("卡过期了（可重起草）", dead, null, at(1), "chase_on");
  // 手工联系
  const manual = snap({ threadId: null });
  const o7 = consistent("手工联系（没有邮件线程）", manual, replyBy, at(1), "manual_only");
  ok("手工联系：扫描跳过 no_thread；写出将标未响应的日期并与判定一致", decide(manual, at(1), replyBy).skipped.some((s) => s.reason === "no_thread") && o7.kind === "manual_only" && o7.noResponseAt != null && markedNoResp(manual, o7.noResponseAt, replyBy) && !markedNoResp(manual, minus1(o7.noResponseAt), replyBy));
  ok("手工联系、没有回复截止：不会自动标未响应", nextChaseOutlook(snap({ threadId: null }), { now: at(1), chaseAfterDays: days, replyBy: null }).kind === "manual_only" && (nextChaseOutlook(snap({ threadId: null }), { now: at(1), chaseAfterDays: days, replyBy: null }) as { noResponseAt: Date | null }).noResponseAt === null);
  // 已报价缺字段：下一次扫描就追问
  const notes = "[auto 2026-11-04T10:00:00.000Z msg=gm1] 单价=12.5；贸易条款=FOB；缺：有效期";
  const qMissing = snap({ status: "quoted", quote: { unitPrice: 12.5, totalPrice: null, deliveryDays: 20, validUntil: null, quoteNotes: notes, updatedAt: new Date("2026-11-04T10:00:00Z") } });
  const o8 = nextChaseOutlook(qMissing, { now: at(3), chaseAfterDays: days, replyBy: null });
  ok("已报价缺字段：下次扫描追问（扫描此刻就会起草追问）", o8.kind === "chase_on" && o8.chaseKind === "missing_fields" && decide(qMissing, at(3), null).drafts.some((d) => d.kind === "missing_fields"));
  const asked = snap({ ...qMissing, chases: [{ index: 1, kind: "missing_fields", messageId: "m9", at: at(3) }] });
  ok("已追问过：不再追问（already_asked）", nextChaseOutlook(asked, { now: at(4), chaseAfterDays: days, replyBy: null }).kind === "asked_wait" && decide(asked, at(4), null).skipped.some((s) => s.reason === "already_asked"));
  const complete = snap({ status: "quoted", quote: { unitPrice: 12.5, totalPrice: null, deliveryDays: 20, validUntil: new Date("2026-12-31"), quoteNotes: "[auto 2026-11-04T10:00:00.000Z msg=gm1] 单价=12.5；贸易条款=FOB", updatedAt: new Date("2026-11-04T10:00:00Z") } });
  ok("已报价、不缺：done（扫描 quoted）", nextChaseOutlook(complete, { now: at(4), chaseAfterDays: days, replyBy: null }).kind === "done" && decide(complete, at(4), null).skipped.some((s) => s.reason === "quoted"));
  ok("未响应：done", nextChaseOutlook(snap({ status: "no_response" }), { now: at(4), chaseAfterDays: days, replyBy: null }).kind === "done");
  // 间隔天数不同
  const o9 = nextChaseOutlook(snap(), { now: at(1), chaseAfterDays: 5, replyBy: null });
  ok("间隔 5 天：at = 发出 + 5 天，且与 decideChases（5 天）一致", o9.kind === "chase_on" && o9.at.getTime() === at(5).getTime() && decideChases({ now: o9.at, chaseAfterDays: 5, replyBy: null, items: [snap()] }).drafts.length === 1 && decideChases({ now: minus1(o9.at), chaseAfterDays: 5, replyBy: null, items: [snap()] }).drafts.length === 0);
}

console.log("文案与日期");
{
  const now = at(1);
  const t = (o: ChaseOutlook) => outlookText(o, TZ, now);
  ok("下次自动催（按组织时区的月-日）", t({ kind: "chase_on", at: new Date("2026-11-09T03:00:00Z"), chaseKind: "no_reply" }) === "下次自动催 11-08");
  ok("已经到期还没扫描：写「今天」", t({ kind: "chase_on", at: minus1(now), chaseKind: "no_reply" }) === "下次自动催 今天");
  ok("将于某天标未响应", t({ kind: "no_response_on", at: new Date("2026-11-12T15:00:00Z") }) === "将于 11-12 标未响应");
  ok("待批卡带未响应日期：写出来", t({ kind: "card_pending", noResponseAt: new Date("2026-11-12T15:00:00Z") }) === "催单卡待批；若一直不批，将于 11-12 标未响应");
  ok("催单卡待批 / 手工联系 / 已追问 / 已催满", t({ kind: "card_pending", noResponseAt: null }) === "催单卡待批" && t({ kind: "manual_only", noResponseAt: null }) === "手工联系，系统不会自动催" && t({ kind: "asked_wait" }) === "已追问过缺的字段，等供应商回复" && (t({ kind: "max_reached_wait", at: new Date("2026-11-12T15:00:00Z") }) ?? "").startsWith("已催满 2 次"));
  ok("done：没有下一步文案", t({ kind: "done" }) === null);
  ok("时间点按时区：多伦多 11-09 23:30（UTC 11-10 04:30）记 11-09", zonedMonthDay(new Date("2026-11-10T04:30:00Z"), TZ) === "11-09");
  ok("时间点恰好 UTC 零点也按时区（多伦多是前一天晚上）", zonedMonthDay(new Date("2026-11-10T00:00:00Z"), TZ) === "11-09");
  const v = trackerRowView({ status: "sent", sentAt: new Date("2026-11-06T14:00:00Z"), noReplyChases: 1, outlook: { kind: "chase_on", at: new Date("2026-11-09T15:00:00Z"), chaseKind: "no_reply" }, missing: [], replyBy: new Date("2026-11-13T00:00:00Z"), hasThread: true }, TZ, now);
  ok("一行的各列：等回复 · 发出于 11-06 · 已催 1 次 · 下次自动催 11-09 · 回复截止 11-13（纯日期不差一天）", v.statusLabel === "等回复" && v.sentText === "发出于 11-06" && v.chasedText === "已催 1 次" && v.outlookText === "下次自动催 11-09" && v.replyByText === "回复截止 11-13" && v.missingText === null, v);
  const v2 = trackerRowView({ status: "quoted", sentAt: null, noReplyChases: 0, outlook: { kind: "done" }, missing: ["validUntil", "currency"], replyBy: null, hasThread: true }, TZ, now);
  ok("缺字段列：缺：有效期、币种；没催过不写次数", v2.missingText === "缺：有效期、币种" && v2.chasedText === null && v2.statusLabel === "已报价");
}

console.log("需要我处理");
{
  const now = at(10);
  const base = { now, replyBy: null as Date | null };
  ok("催单卡待批", classifyNeedsAction({ ...base, status: "sent", outlook: { kind: "card_pending", noResponseAt: null }, missing: [] }) === "chase_card_pending");
  ok("回信没报价", classifyNeedsAction({ ...base, status: "replied", outlook: { kind: "chase_on", at: now, chaseKind: "missing_fields" }, missing: ["price"] }) === "reply_no_quote");
  ok("报价缺字段", classifyNeedsAction({ ...base, status: "quoted", outlook: { kind: "asked_wait" }, missing: ["validUntil"] }) === "missing_fields");
  ok("过了回复截止还没回", classifyNeedsAction({ now, replyBy: new Date("2026-11-05T00:00:00Z"), status: "sent", outlook: { kind: "no_response_on", at: now }, missing: [] }) === "past_reply_by");
  ok("过了回复截止但已报价（不缺）：不是「过了截止没回」", classifyNeedsAction({ now, replyBy: new Date("2026-11-05T00:00:00Z"), status: "quoted", outlook: { kind: "done" }, missing: [] }) === null);
  ok("回复截止当天还不算过", classifyNeedsAction({ now: new Date("2026-11-05T20:00:00Z"), replyBy: new Date("2026-11-05T00:00:00Z"), status: "sent", outlook: { kind: "chase_on", at: now, chaseKind: "no_reply" }, missing: [] }) === null);
  ok("在等回复、已报价齐全、未响应：都不是", classifyNeedsAction({ ...base, status: "sent", outlook: { kind: "chase_on", at: now, chaseKind: "no_reply" }, missing: [] }) === null && classifyNeedsAction({ ...base, status: "quoted", outlook: { kind: "done" }, missing: [] }) === null && classifyNeedsAction({ ...base, status: "no_response", outlook: { kind: "done" }, missing: [] }) === null);
  ok("待批卡优先于缺字段", classifyNeedsAction({ ...base, status: "quoted", outlook: { kind: "card_pending", noResponseAt: null }, missing: ["validUntil"] }) === "chase_card_pending");
}

console.log("计数与汇总卡");
{
  const now = at(10);
  const rows = [
    { status: "sent", needsAction: null, repliedAt: null },
    { status: "sent", needsAction: "chase_card_pending" as const, repliedAt: null },
    { status: "sent", needsAction: "past_reply_by" as const, repliedAt: null },
    { status: "quoted", needsAction: null, repliedAt: at(8) },
    { status: "quoted", needsAction: "missing_fields" as const, repliedAt: at(1) },
    { status: "replied", needsAction: "reply_no_quote" as const, repliedAt: at(9) },
    { status: "no_response", needsAction: null, repliedAt: null },
  ];
  const s = trackerSummary(rows, now);
  ok("计数：需要我处理 4 · 等回复 3 · 已报价 2 · 未响应 1 · 待批卡 1 · 本周已报价 1", s.needsAction === 4 && s.waiting === 3 && s.quoted === 2 && s.noResponse === 1 && s.pendingCards === 1 && s.quotedThisWeek === 1, s);
  const card = summaryCardText(s);
  ok("汇总卡文案只有计数", card === "询价追踪：3 家等回复 · 1 张催单待批 · 本周 1 家已报价" && !/\$|CAD|USD|元/.test(card), card);
  ok("没有在途询价", summaryCardText(trackerSummary([], now)) === "询价追踪：没有在途询价" && EMPTY_TRACKER_ZH.includes("问供应商要价"));
  ok("只有需要我处理的（没有等回复、待批卡、本周报价）：不说「没有在途询价」", summaryCardText({ needsAction: 2, waiting: 0, quoted: 1, noResponse: 0, pendingCards: 0, quotedThisWeek: 0 }) === "询价追踪：2 项需要我处理");
  ok("只有较早的报价 / 只有未响应：照实写", summaryCardText({ needsAction: 0, waiting: 0, quoted: 3, noResponse: 0, pendingCards: 0, quotedThisWeek: 0 }) === "询价追踪：3 家已报价" && summaryCardText({ needsAction: 0, waiting: 0, quoted: 0, noResponse: 2, pendingCards: 0, quotedThisWeek: 0 }) === "询价追踪：2 家未响应");
}

console.log("报价列（与比价矩阵对照）");
{
  const NOW = new Date("2026-11-15T12:00:00Z");
  const FULL: LandedCostSettings = { fxRates: { USD: 1.36, CNY: 0.19 }, fxAsOf: "2026-11-10", fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, exportInlandEstimate: null, insurancePct: 1, clearanceFlatCad: 150, projects: {} };
  const mk = (id: string, q: { unitPrice: number | null; totalPrice: number | null; currency: string; incoterm: string }, settings = FULL): CompareInput => {
    const quoted = { ...q, moq: null, deliveryDays: 21, validUntil: "2026-12-31" };
    return { itemId: id, supplierId: id, supplierName: id, quoted, emailDate: new Date("2026-11-10"), mandatoryAnswers: [], normalized: normalizeQuote(q, { settings, dutyRatePct: 6.5, quantity: 200, now: NOW }) };
  };
  const inputs = [
    mk("a", { unitPrice: 89.5, totalPrice: 17900, currency: "USD", incoterm: "FOB" }),
    mk("b", { unitPrice: 95, totalPrice: null, currency: "USD", incoterm: "FOB" }),
    mk("c", { unitPrice: 80, totalPrice: null, currency: "USD", incoterm: "FOB" }, { ...FULL, freightEstimate: null }),
    mk("d", { unitPrice: null, totalPrice: 16000, currency: "USD", incoterm: "DDP" }),
  ];
  const m = buildCompareMatrix(inputs, { closeDate: new Date("2026-12-20"), deliveryDeadline: null, firstTierQty: 200, mandatoryCodes: [], now: NOW });
  const row = (id: string) => m.rows.find((r) => r.itemId === id)!;
  const cell = (id: string, q: { unitPrice: number | null; totalPrice: number | null; currency: string }) => quoteCellView({ ...q, deliveryDays: 21, validUntil: new Date("2026-12-31T00:00:00Z") }, row(id), { matrixLoaded: true, timeZone: TZ, canViewCost: true });
  const a = cell("a", { unitPrice: 89.5, totalPrice: 17900, currency: "USD" });
  ok("齐全：原币种单价 / 总价 / 交期 / 有效期；落地价取矩阵（四舍五入到元）", a.quoteText === "报价 USD 89.50 / 件 · 总价 USD 17,900 · 交期 21 天 · 有效至 12-31" && a.landedText === `落地价 CAD ${Math.round(row("a").landedCad.total!).toLocaleString("en-US")}`, a);
  const c = cell("c", { unitPrice: 80, totalPrice: null, currency: "USD" });
  ok("缺落地价参数：写矩阵给的原因，给去比价链接", c.landedText === `落地价未换算（${row("c").blockers[0]}）` && c.needsCompareLink && !c.cheapest, c);
  const cheapestId = m.cheapestItemId!;
  const cells = ["a", "b", "d"].map((id) => ({ id, c: cell(id, { unitPrice: inputs.find((x) => x.itemId === id)!.quoted.unitPrice, totalPrice: inputs.find((x) => x.itemId === id)!.quoted.totalPrice, currency: "USD" }) }));
  ok("「最便宜」标在矩阵认定的那一家，且只有它", cells.filter((x) => x.c.cheapest).map((x) => x.id).join() === cheapestId, { cheapestId, cells });
  const d = cells.find((x) => x.id === "d")!.c;
  ok("只有总价：写「报价总价」", (d.quoteText ?? "").startsWith("报价总价 USD 16,000"));
  const b = cells.find((x) => x.id === "b")!.c;
  ok("只有单价：写单价，不写总价", (b.quoteText ?? "").startsWith("报价 USD 95.00 / 件") && !(b.quoteText ?? "").includes("总价"));
  ok("每一家的落地价与矩阵逐家一致", ["a", "b", "d"].every((id) => cells.find((x) => x.id === id)!.c.landedText === `落地价 CAD ${Math.round(row(id).landedCad.total!).toLocaleString("en-US")}`));
  const capped = quoteCellView({ unitPrice: 1, totalPrice: null, currency: "usd", deliveryDays: null, validUntil: null }, null, { matrixLoaded: false, timeZone: TZ, canViewCost: true });
  ok("超过上限没算矩阵：写「请到比价面板查看」；币种转大写", capped.landedText === "落地价请到比价面板查看" && capped.needsCompareLink && (capped.quoteText ?? "").startsWith("报价 USD 1.00 / 件"));
  ok("没有报价字段：quoteText 为空", quoteCellView({ unitPrice: null, totalPrice: null, currency: null, deliveryDays: null, validUntil: null }, null, { matrixLoaded: true, timeZone: TZ, canViewCost: true }).quoteText === null);
  ok("有效期是 UTC 零点日期：按字面月日，不差一天", (a.quoteText ?? "").includes("有效至 12-31"));
  const two = quoteCellView({ unitPrice: 1, totalPrice: null, currency: "USD", deliveryDays: null, validUntil: null }, { landedCad: { unit: null, total: null }, flags: [], blockers: ["缺运费估算参数", "缺关税率"] }, { matrixLoaded: true, timeZone: TZ, canViewCost: true });
  ok("换算不出有几条原因：写第一条（矩阵的主要原因）", two.landedText === "落地价未换算（缺运费估算参数）");

  // CHAIN-2e：没有财务查看权的那一格（tracker.ts 在组装前已把那几家的落地价置空，只留标记与原因）
  const qOf = (id: string) => ({ unitPrice: inputs.find((x) => x.itemId === id)!.quoted.unitPrice, totalPrice: inputs.find((x) => x.itemId === id)!.quoted.totalPrice, currency: "USD" });
  const trimmed = (id: string) => ({ landedCad: { unit: null, total: null }, flags: row(id).flags, blockers: row(id).blockers });
  const hcell = (id: string, r: Parameters<typeof quoteCellView>[1] = trimmed(id)) => quoteCellView({ ...qOf(id), deliveryDays: 21, validUntil: new Date("2026-12-31T00:00:00Z") }, r, { matrixLoaded: true, timeZone: TZ, canViewCost: false });
  ok("CHAIN-2e 提示句", LANDED_HIDDEN_CELL_ZH === "落地价只给有财务查看权的人看");
  const ha = hcell("a");
  ok("CHAIN-2e 无权、换算出了：写「落地价只给有财务查看权的人看」，没有金额、不给去比价链接；原币种报价照常", ha.landedText === LANDED_HIDDEN_CELL_ZH && !ha.needsCompareLink && ha.quoteText === a.quoteText, ha);
  ok("CHAIN-2e 无权：「最便宜」照常标在矩阵认定的那一家，且只有它", ["a", "b", "d"].filter((id) => hcell(id).cheapest).join() === cheapestId);
  const hc = hcell("c");
  ok("CHAIN-2e 无权、换算不出：照旧写矩阵给的原因、给去比价链接", hc.landedText === c.landedText && hc.needsCompareLink && !hc.cheapest, hc);
  const hcap = quoteCellView({ unitPrice: 1, totalPrice: null, currency: "usd", deliveryDays: null, validUntil: null }, null, { matrixLoaded: false, timeZone: TZ, canViewCost: false });
  ok("CHAIN-2e 无权、超过上限没取矩阵：写同一句，不写「请到比价面板查看」、不给链接", hcap.landedText === LANDED_HIDDEN_CELL_ZH && !hcap.needsCompareLink);
  const hnone = quoteCellView({ unitPrice: 1, totalPrice: null, currency: "USD", deliveryDays: null, validUntil: null }, null, { matrixLoaded: true, timeZone: TZ, canViewCost: false });
  ok("CHAIN-2e 无权、没有矩阵行（还没报价）：与有权一样为空", hnone.landedText === null && !hnone.needsCompareLink && !hnone.cheapest);
  // CHAIN-2e 审查 F5：授权查询出错（暂时无法确认）时那一格写短版「暂时无法确认查看权限」，不说成没有权限
  const ucell = (id: string) => quoteCellView({ ...qOf(id), deliveryDays: 21, validUntil: new Date("2026-12-31T00:00:00Z") }, trimmed(id), { matrixLoaded: true, timeZone: TZ, canViewCost: false, costUnconfirmed: true });
  ok("CHAIN-2e 暂时无法确认：换算出了的那一格写短版，没有链接；「最便宜」照常", LANDED_UNCONFIRMED_CELL_ZH === "暂时无法确认查看权限，请稍后刷新" && ucell("a").landedText === LANDED_UNCONFIRMED_CELL_ZH && !ucell("a").needsCompareLink && ["a", "b", "d"].filter((id) => ucell(id).cheapest).join() === cheapestId, ucell("a"));
  ok("CHAIN-2e 暂时无法确认：换算不出的照旧写原因、给链接；超过上限没取矩阵也写短版", ucell("c").landedText === c.landedText && ucell("c").needsCompareLink && quoteCellView({ unitPrice: 1, totalPrice: null, currency: "USD", deliveryDays: null, validUntil: null }, null, { matrixLoaded: false, timeZone: TZ, canViewCost: false, costUnconfirmed: true }).landedText === LANDED_UNCONFIRMED_CELL_ZH);
  ok("CHAIN-2e 有权限时 costUnconfirmed 不起作用", quoteCellView({ ...qOf("a"), deliveryDays: 21, validUntil: new Date("2026-12-31T00:00:00Z") }, row("a"), { matrixLoaded: true, timeZone: TZ, canViewCost: true, costUnconfirmed: true }).landedText === a.landedText);
  ok("CHAIN-2e 哪些格子算「因权限被隐藏」：两句短句算；换算不出、超过上限（有权）、没有报价不算", isPermissionHiddenCell(ha) && isPermissionHiddenCell(ucell("a")) && !isPermissionHiddenCell(hc) && !isPermissionHiddenCell(capped) && !isPermissionHiddenCell(null) && !isPermissionHiddenCell(hnone));
  ok("CHAIN-2e 整页提示原因：没有被隐藏的格子 → 不提示；暂时无法确认优先；按有没有真人负责人分 no_access / no_owner / mixed",
    trackerLandedHiddenReason({ unconfirmed: true, hiddenProjects: 0, hiddenWithOwner: 0 }) === null
    && trackerLandedHiddenReason({ unconfirmed: true, hiddenProjects: 2, hiddenWithOwner: 2 }) === "unconfirmed"
    && trackerLandedHiddenReason({ unconfirmed: false, hiddenProjects: 2, hiddenWithOwner: 2 }) === "no_access"
    && trackerLandedHiddenReason({ unconfirmed: false, hiddenProjects: 2, hiddenWithOwner: 0 }) === "no_owner"
    && trackerLandedHiddenReason({ unconfirmed: false, hiddenProjects: 2, hiddenWithOwner: 1 }) === "mixed");
  const leaked = hcell("a", row("a"));
  ok("CHAIN-2e 即使传进完整矩阵行，无权时也不写金额", leaked.landedText === LANDED_HIDDEN_CELL_ZH && !JSON.stringify(leaked).includes(Math.round(row("a").landedCad.total!).toLocaleString("en-US")));
}

console.log("页签、全部批准、催单卡、跳过原因");
{
  const sum = { needsAction: 2, waiting: 3, quoted: 1, noResponse: 1, pendingCards: 1, quotedThisWeek: 1 };
  ok("页签与计数：需要我处理 / 等回复 / 已报价 / 未响应", TRACKER_TABS.map((t) => `${t.label}${t.count(sum)}`).join("|") === "需要我处理2|等回复3|已报价1|未响应1");
  ok("每个页签收哪些行", rowInTab({ status: "sent", needsAction: null }, "waiting") && !rowInTab({ status: "sent", needsAction: null }, "needs") && rowInTab({ status: "quoted", needsAction: "missing_fields" }, "needs") && rowInTab({ status: "quoted", needsAction: null }, "quoted") && rowInTab({ status: "no_response", needsAction: null }, "no_response"));
  const groups = [
    { project: "A", rounds: [{ rows: [{ status: "sent", needsAction: null }, { status: "quoted", needsAction: null }] }, { rows: [{ status: "sent", needsAction: "past_reply_by" }] }] },
    { project: "B", rounds: [{ rows: [{ status: "quoted", needsAction: null }] }] },
  ];
  const needs = filterTrackerGroups(groups, "needs");
  ok("按页签过滤：没有行的轮次与项目去掉", needs.length === 1 && needs[0].rounds.length === 1 && needs[0].rounds[0].rows.length === 1 && filterTrackerGroups(groups, "quoted").length === 2 && filterTrackerGroups(groups, "no_response").length === 0);
  const card = (canApprove: boolean, status = "PENDING") => ({ approval: { canApprove, status } });
  ok("按项目进来：默认第一个有内容的页签；都没有就「需要我处理」", firstTabWithRows([{ rounds: [{ rows: [{ status: "sent", needsAction: null }] }] }]) === "waiting" && firstTabWithRows([{ rounds: [{ rows: [{ status: "sent", needsAction: "past_reply_by" }] }] }]) === "needs" && firstTabWithRows([]) === "needs");
  ok("全部批准只收能批、还在待批的卡", approvableCards([{ cards: [card(true), card(false)] }, { cards: [card(true, "EXPIRED"), card(true)] }]).length === 2);
  ok("催单卡键：第 1 次、第 2 次、追问、重起草后缀", JSON.stringify(parseChaseCardKey("tender.send_chase:it1:1")) === JSON.stringify({ itemId: "it1", chaseKind: "no_reply", chaseIndex: 1 }) && parseChaseCardKey("tender.send_chase:it1:2:r1")?.chaseIndex === 2 && parseChaseCardKey("tender.send_chase:it9:missing_fields")?.chaseKind === "missing_fields");
  ok("别的类型或格式不对：不认", parseChaseCardKey("tender.send_rfq:it1:1") === null && parseChaseCardKey(null) === null && parseChaseCardKey("tender.send_chase:it1:3") === null);
  ok("跳过原因说人话（任务书列的几种）", chaseSkipZh("pending_card") === "已有一张待批的催单卡" && chaseSkipZh("max_reached") === "已经催过两次" && chaseSkipZh("no_thread") === "这家是手工联系的，没有邮件线程可回复" && chaseSkipZh("quoted") === "已经报价，不用催" && chaseSkipZh("whatever") === "这家现在不能催" && Object.values(CHASE_SKIP_ZH).every((t) => !/[a-z_]{4,}/.test(t)));
}

console.log("汇总卡呈现");
{
  const html = renderToStaticMarkup(<RfqTrackerSummaryCardView summary={{ needsAction: 3, waiting: 6, quoted: 2, noResponse: 0, pendingCards: 2, quotedThisWeek: 3 }} />);
  ok("汇总卡：计数文案、链到 /bids/rfq、写需要我处理几项；没有金额", html.includes("询价追踪：6 家等回复 · 2 张催单待批 · 本周 3 家已报价") && html.includes('href="/bids/rfq"') && html.includes("需要我处理 3") && !/\$|CAD|USD/.test(html));
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const svc = read("src/lib/tender-rfq/tracker.ts");
  const api = read("src/app/api/org/tender-rfq/tracker/route.ts");
  const chase = read("src/app/api/projects/[id]/tender-rfq/chase/route.ts");
  const page = read("src/components/bids/rfq-tracker.tsx");
  const shell = read("src/components/bids/bids-workspace-shell.tsx");
  const cs = read("src/lib/tender-rfq/chase-service.ts");
  ok("追踪接口：组织按登录者解析，不取别的", api.includes("resolveRequestOrgIdForUser(user, searchParams.get(\"orgId\"))") && api.includes("orgId: orgRes.orgId"));
  ok("取数：与项目读权限同一规则 + 招投标 + 有在途询价；条目复用 loadItems（带 projectIds）", svc.includes("projectReadWhere(input.user, input.orgId)") && svc.includes('{ workDomain: "tender" }, inFlightWhere(now)') && svc.includes("loadItems({ orgId: input.orgId, projectIds }, now)"));
  ok("间隔与扫描同一来源（chaseDaysForRound + 跟进授权状态）", svc.includes("chaseDaysForRound(") && svc.includes("loadFollowUpRoundState(input.orgId, it.inquiryId)") && cs.includes("const days = chaseDaysForRound(orgSettingsJson, owner, followUp);"));
  ok("价格只取比价矩阵（loadCompareMatrix），不自己换汇", svc.includes("loadCompareMatrix({ projectId: r.projectId, orgId: input.orgId, inquiryId, now })") && !/fxRates|normalizeQuote/.test(svc));
  ok("白名单：页面行只有这些字段；不带估值、我方报价、毛利", svc.includes("const publicRow = (b: Built): TrackerRow => ({") && !/estimatedValue|ourBidPrice|winningBidPrice|margin/i.test(svc));
  ok("现在就催：项目写权限、1–8 家、复用 draftChasesForProject（只起草）", chase.includes("requireProjectWriteAccess(request, projectId)") && chase.includes(".min(1).max(8)") && chase.includes("draftChasesForProject({") && !/chase-execute|sendEmail\(|sendGmail|gmail\.users/i.test(chase));
  ok("页面：全部批准逐张顺序调用既有 approve 接口；单张用 RfqApprovalPanel；全部批准进行中那一轮不显示单张面板", /for \(const c of cards\) \{[\s\S]*?\/approve\?orgId=/.test(page) && page.includes('variant="chase"') && page.includes("{busyRound === r.inquiryId ? null : cards.map((c) => ("));
  ok("页面：只认最后一次读取；已有数据时读取失败不清空页面", page.includes("if (seq !== loadSeq.current) return;") && page.includes("if (error && !data) return"));
  ok("页面：按项目进来时默认第一个有内容的页签，并可看全部", page.includes("setTab(firstTabWithRows(payload.groups));") && page.includes('data-testid="rfq-tracker-project-filter"'));
  ok("/bids 顶部挂汇总卡", shell.includes("<RfqTrackerSummaryCard />"));
  // 客户端组件不能（直接或间接）引用 node: 模块，否则 next build 打包失败：只从 tracker-view 取，tracker-view 不引用任何模块
  const view = read("src/lib/tender-rfq/tracker-view.ts");
  const card = read("src/components/bids/rfq-tracker-summary-card.tsx");
  ok("tracker-view 不引用任何模块（尤其 chase-pure / node:）", !/^\s*import\s/m.test(view) && !/from\s+"/.test(view));
  ok("追踪页与汇总卡只从 tracker-view 取，不从 tracker-pure / chase-pure 取", page.includes('from "@/lib/tender-rfq/tracker-view"') && card.includes('from "@/lib/tender-rfq/tracker-view"') && !/from "@\/lib\/tender-rfq\/(tracker-pure|chase-pure)"/.test(page + card));
  ok("tracker-pure 原样转出 tracker-view 的名字", read("src/lib/tender-rfq/tracker-pure.ts").includes('} from "./tracker-view";'));
  // CHAIN-2e：有行的落地价被隐藏时页面顶部写一次谁能看、找谁（按原因换句）；提示模块链上没有 node: 与读库模块
  ok("CHAIN-2e 页面：landedHidden 时顶部写一次提示（按 hintReason 换句）", /\{data\.landedHidden \? <p[^>]*data-testid="landed-hidden-hint">\{financeHiddenHintZh\("落地价", data\.hintReason \?\? "no_access"\)\}<\/p> : null\}/.test(page) && page.includes('from "@/lib/project-finance/view-hint"'));
  const hintChain = ["src/lib/project-finance/view-hint.ts", "src/lib/tender-pricing/finance-view.ts", "src/lib/tender-pricing/calc.ts"].map(read).join("\n");
  ok("CHAIN-2e 提示模块链（view-hint → finance-view → calc）不引用 node: / 读库模块", !/from "node:|from "@\/lib\/db"|from "next\//.test(hintChain));
  ok("CHAIN-2e 取数：有格子因权限被隐藏时整页带 landedHidden 与提示原因；汇总卡不算", /landed = \{ landedHidden: true, \.\.\.hintReasonField\(reason\) \};/.test(svc) && /return \{ summary, groups, timeZone, truncated, \.\.\.landed \};/.test(svc) && svc.indexOf("if (input.summaryOnly) return { summary, groups: [], timeZone, truncated };") < svc.indexOf("const hiddenProjects"));
  // CHAIN-2e 审查 F3 / F4 / F5：canViewCostOf 的定义、隐藏项目只按截断后留下的、真正因权限被隐藏的格子算、暂时无法确认接到格子与整页提示
  ok("CHAIN-2e 取数：canViewCostOf = 组织级可看 || 本人负责", /const canViewCostOf = \(projectId: string\) => !!orgFinance && \(orgFinance\.canReadAll \|\| ownerOf\.get\(projectId\) === input\.user\.id\);/.test(svc));
  ok("CHAIN-2e 取数：每一格带 canViewCost 与 costUnconfirmed（授权查询出错）", /canViewCost: canViewCostOf\(s\.projectId\), costUnconfirmed: !!orgFinance\?\.unconfirmed \}/.test(svc));
  ok("CHAIN-2e 取数：被隐藏的项目按截断后留下的行、因权限被隐藏的格子、且 !canViewCostOf 算", /const hiddenProjects = \[\.\.\.new Set\(rows\.filter\(\(r\) => isPermissionHiddenCell\(r\.quote\) && !canViewCostOf\(r\.projectId\)\)\.map\(\(r\) => r\.projectId\)\)\];/.test(svc) && svc.indexOf("rows = [...rows].sort(") < svc.indexOf("const hiddenProjects"));
  ok("CHAIN-2e 取数：整页原因用 trackerLandedHiddenReason，暂时无法确认接自组织级判定", /const reason = trackerLandedHiddenReason\(\{ unconfirmed: !!orgFinance\?\.unconfirmed, hiddenProjects: hiddenProjects\.length, hiddenWithOwner \}\);/.test(svc) && /if \(reason\) landed = \{ landedHidden: true, \.\.\.hintReasonField\(reason\) \};/.test(svc));
}

console.log(`\ntracker-pure: ${passed} passed`);
