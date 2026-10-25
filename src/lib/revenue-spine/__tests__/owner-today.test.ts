/**
 * 老板「今日询盘」分栏：组织时区切日（Asia/Shanghai 当地零点，不是 UTC 零点）/ 回复超时 / 审批关联 /
 * 样品报价合并去重。纯函数，无 DB。
 * 运行：npx tsx src/lib/revenue-spine/__tests__/owner-today.test.ts
 *
 * 公开仓库：只用虚构企业。
 */
import assert from "node:assert/strict";
import type { QueueOpportunity } from "../daily-actions";
import { bucketOwnerToday, localDayBounds, type OwnerApprovalInput, type OwnerDueInput } from "../owner-today";
import { DEFAULT_REVENUE_SPINE_POLICY } from "../policy";
import { OPPORTUNITY_SOURCE_LABELS, opportunitySourceLabel } from "../source-labels";
import { OPPORTUNITY_SOURCES } from "../inquiry-intake";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const SH = "Asia/Shanghai";
const policy = DEFAULT_REVENUE_SPINE_POLICY;
// 当地 2026-10-24 10:00（UTC 02:00）
const NOW = new Date("2026-10-24T02:00:00Z");
const { start: DAY_START, end: DAY_END } = localDayBounds(NOW, SH);

function opp(over: Partial<QueueOpportunity> & { id: string }): QueueOpportunity {
  return {
    title: `Bath towels — ${over.customerName ?? "Example Textiles"}`,
    stage: "new_inquiry",
    customerId: `c_${over.id}`,
    customerName: "Example Textiles",
    customerEmail: "buyer@example-textiles.test",
    score: null,
    scoreGrade: null,
    priority: "warm",
    estimatedValue: null,
    market: "Canada",
    buyerType: null,
    assignedToId: "u_rep",
    createdAt: new Date("2026-10-20T02:00:00Z"),
    updatedAt: new Date("2026-10-20T02:00:00Z"),
    stageChangedAt: null,
    lastInteractionAt: null,
    lastCustomerReplyAt: null,
    lastOutboundAt: null,
    nextFollowupAt: null,
    nextActionType: null,
    nextActionReason: null,
    followUpCount: 0,
    fdeInfluenced: false,
    fdeSourced: false,
    source: "website_inquiry",
    ...over,
  };
}

console.log("owner-today");

ok("当地日界：Asia/Shanghai 零点 = 前一天 UTC 16:00；跨过当地零点就是新的一天", () => {
  assert.equal(DAY_START.toISOString(), "2026-10-23T16:00:00.000Z");
  assert.equal(DAY_END.toISOString(), "2026-10-24T16:00:00.000Z");
  assert.equal(localDayBounds(new Date("2026-10-24T15:59:00Z"), SH).day, "2026-10-24"); // 当地 23:59
  assert.equal(localDayBounds(new Date("2026-10-24T16:00:00Z"), SH).day, "2026-10-25"); // 当地 00:00
  // 夏令时结束当天（多伦多 2026-11-01）是 25 小时
  const tor = localDayBounds(new Date("2026-11-01T15:00:00Z"), "America/Toronto");
  assert.equal(tor.start.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(tor.end.toISOString(), "2026-11-02T05:00:00.000Z");
});

ok("今日新询盘按组织当地零点切：同一个 UTC 日期里，当地昨天 23:59 的不算、当地今天 00:30 的算", () => {
  const rows = [
    opp({ id: "yesterday_local", createdAt: new Date("2026-10-23T15:59:00Z"), score: 95, scoreGrade: "HOT" }), // 当地 10/23 23:59
    opp({ id: "today_0030", createdAt: new Date("2026-10-23T16:30:00Z"), score: 60, scoreGrade: "MEDIUM" }), // 当地 10/24 00:30
    opp({ id: "today_0900", createdAt: new Date("2026-10-24T01:00:00Z"), score: 82, scoreGrade: "HOT", source: "trade_show" }),
    opp({ id: "today_disq", createdAt: new Date("2026-10-24T01:30:00Z"), stage: "disqualified" }),
    opp({ id: "future", createdAt: new Date("2026-10-24T03:00:00Z") }),
  ];
  const b = bucketOwnerToday(rows, [], [], policy, NOW, DAY_START, DAY_END);
  assert.deepEqual(b.newToday.map((c) => c.opportunityId), ["today_0900", "today_0030", "today_disq"]);
  assert.equal(b.counts.newToday, 3);
  const hot = b.newToday[0];
  assert.equal(hot.sourceLabel, "展会");
  assert.equal(hot.ageMinutes, 60);
  assert.equal(hot.market, "Canada");
  assert.equal((hot as unknown as Record<string, unknown>).customerEmail, undefined, "卡片不带买家邮箱");
});

ok("回复超时：只看回复新询盘 / 回复客户来信，已过时限的按超时时长倒序；终结商机和其它下一步不算", () => {
  const rows = [
    opp({ id: "late_2h", stage: "new_inquiry", nextActionType: "reply_inquiry", nextFollowupAt: new Date("2026-10-24T00:00:00Z") }),
    opp({ id: "late_30m", stage: "needs_info", nextActionType: "reply_customer", nextFollowupAt: new Date("2026-10-24T01:30:00Z") }),
    opp({ id: "not_yet", nextActionType: "reply_inquiry", nextFollowupAt: new Date("2026-10-24T03:00:00Z") }),
    opp({ id: "quote_due", stage: "quoted", nextActionType: "quote_follow_up", nextFollowupAt: new Date("2026-10-23T00:00:00Z") }),
    opp({ id: "won_stale_action", stage: "won", nextActionType: "reply_customer", nextFollowupAt: new Date("2026-10-23T00:00:00Z") }),
  ];
  const b = bucketOwnerToday(rows, [], [], policy, NOW, DAY_START, DAY_END);
  assert.deepEqual(b.overdue.map((o) => [o.opportunityId, o.overdueMinutes]), [["late_2h", 120], ["late_30m", 30]]);
  assert.equal(b.overdue[0].slaHours, policy.salesSla.newInquiryResponseHours);
  assert.equal(b.overdue[1].slaHours, policy.salesSla.customerReplyResponseHours);
});

ok("待审批：只要 pending 且未过期；按 payload.opportunityId 关联商机卡；按评分排序；关联不到的保留但不带商机", () => {
  const rows = [opp({ id: "o_hot", score: 82, scoreGrade: "HOT" }), opp({ id: "o_low", score: 40, scoreGrade: "LOW", customerName: "Maple Home Goods" })];
  const base = { title: "发送询盘回复", preview: "⚠ 风险提醒\n\nSubject\n\nBody\n\n——— 中文对照（仅供审核，不会发送）———", createdAt: new Date("2026-10-24T01:00:00Z"), expiresAt: new Date("2026-10-27T01:00:00Z") };
  const approvals: OwnerApprovalInput[] = [
    { ...base, id: "pa_low", status: "pending", opportunityId: "o_low" },
    { ...base, id: "pa_hot", status: "pending", opportunityId: "o_hot" },
    { ...base, id: "pa_orphan", status: "pending", opportunityId: "o_missing" },
    { ...base, id: "pa_expired", status: "pending", opportunityId: "o_hot", expiresAt: new Date("2026-10-24T01:59:00Z") },
    { ...base, id: "pa_done", status: "executed", opportunityId: "o_hot" },
  ];
  const b = bucketOwnerToday(rows, approvals, [], policy, NOW, DAY_START, DAY_END);
  assert.deepEqual(b.approvals.map((a) => a.pendingActionId), ["pa_hot", "pa_low", "pa_orphan"]);
  assert.equal(b.approvals[0].opportunity?.scoreGrade, "HOT");
  assert.equal(b.approvals[1].opportunity?.customerName, "Maple Home Goods");
  assert.equal(b.approvals[2].opportunity, null);
  assert.match(b.approvals[0].preview, /中文对照/);
  assert.equal(b.approvals[0].waitingMinutes, 60);
  assert.equal(b.counts.approvals, 3);
});

ok("样品与报价：Revenue Spine 下一步 + 外贸寄样单 / 报价单按商机合并，一个商机一张卡；未映射的单据单独成卡；明天到期的不算", () => {
  const rows = [
    opp({ id: "o_quoted", stage: "quoted", nextActionType: "quote_follow_up", nextFollowupAt: new Date("2026-10-24T08:00:00Z"), customerName: "Example Textiles" }),
    opp({ id: "o_sample", stage: "sample", nextActionType: "sample_follow_up", nextFollowupAt: new Date("2026-10-22T08:00:00Z"), customerName: "Maple Home Goods" }),
    opp({ id: "o_tomorrow", stage: "quoted", nextActionType: "quote_follow_up", nextFollowupAt: new Date("2026-10-24T16:00:00Z") }),
    opp({ id: "o_reply", nextActionType: "reply_inquiry", nextFollowupAt: new Date("2026-10-24T01:00:00Z") }),
  ];
  const due: OwnerDueInput[] = [
    { kind: "sample", origin: "trade_sample", refId: "ts_1", opportunityId: "o_quoted", dueAt: new Date("2026-10-24T03:00:00Z"), label: "寄样跟进：Bath towel", companyName: "Example Textiles", country: "Canada" },
    { kind: "quote", origin: "trade_quote", refId: "tq_1", opportunityId: "o_quoted", dueAt: new Date("2026-10-24T09:00:00Z"), label: "报价 Q-001 今天到期", companyName: "Example Textiles", country: "Canada" },
    { kind: "sample", origin: "trade_sample", refId: "ts_1", opportunityId: "o_quoted", dueAt: new Date("2026-10-24T03:00:00Z"), label: "寄样跟进：Bath towel", companyName: "Example Textiles", country: "Canada" },
    { kind: "sample", origin: "trade_sample", refId: "ts_unmapped", opportunityId: null, dueAt: new Date("2026-10-24T05:00:00Z"), label: "寄样跟进：Throw", companyName: "Harbor Linen Co", country: "Australia" },
    { kind: "quote", origin: "trade_quote", refId: "tq_cross", opportunityId: "o_other_org", dueAt: new Date("2026-10-24T06:00:00Z"), label: "报价 Q-002 今天到期", companyName: "Fjord Living", country: "Norway" },
    { kind: "quote", origin: "trade_quote", refId: "tq_tomorrow", opportunityId: null, dueAt: new Date("2026-10-24T16:00:00Z"), label: "报价 Q-003 今天到期", companyName: null, country: null },
  ];
  const b = bucketOwnerToday(rows, [], due, policy, NOW, DAY_START, DAY_END);
  const keys = b.samplesQuotesDue.map((d) => d.key);
  assert.deepEqual(keys, ["opp:o_sample", "opp:o_quoted", "trade_sample:ts_unmapped", "trade_quote:tq_cross"]);
  const merged = b.samplesQuotesDue.find((d) => d.key === "opp:o_quoted")!;
  assert.deepEqual([...merged.kinds].sort(), ["quote", "sample"]);
  assert.equal(merged.reasons.length, 3, "Revenue Spine 跟进 + 寄样单 + 报价单，重复的寄样单只算一次");
  assert.equal(merged.dueAt.toISOString(), "2026-10-24T03:00:00.000Z", "取最早到期");
  assert.equal(merged.overdue, false);
  assert.equal(merged.href, "/revenue/o_quoted");
  assert.equal(merged.opportunity?.customerName, "Example Textiles");
  const sample = b.samplesQuotesDue.find((d) => d.key === "opp:o_sample")!;
  assert.equal(sample.overdue, true);
  const unmapped = b.samplesQuotesDue.find((d) => d.key === "trade_sample:ts_unmapped")!;
  assert.equal(unmapped.href, "/trade/samples/ts_unmapped");
  assert.equal(unmapped.opportunityId, null);
  assert.equal(unmapped.companyName, "Harbor Linen Co");
  const cross = b.samplesQuotesDue.find((d) => d.key === "trade_quote:tq_cross")!;
  assert.equal(cross.opportunityId, null, "映射到不在本组织结果里的商机 → 按未映射处理");
  assert.equal(cross.href, "/trade/quotes/tq_cross");
  assert.equal(b.counts.samplesQuotesDue, 4);
  assert.equal(b.counts.overdue, 1);
});

ok("rows 里同一商机出现两次（主查询 + 补查）只算一次", () => {
  const o = opp({ id: "dup", createdAt: new Date("2026-10-24T01:00:00Z") });
  const b = bucketOwnerToday([o, { ...o }], [], [], policy, NOW, DAY_START, DAY_END);
  assert.equal(b.counts.newToday, 1);
});

ok("来源标签：覆盖 inquiry-intake 的全部来源；未知来源显示「其他」，空值显示「来源未知」", () => {
  for (const s of OPPORTUNITY_SOURCES) assert.ok(OPPORTUNITY_SOURCE_LABELS[s], `缺少 ${s} 的标签`);
  assert.equal(opportunitySourceLabel("website_inquiry"), "官网");
  assert.equal(opportunitySourceLabel("trade_show"), "展会");
  assert.equal(opportunitySourceLabel("email"), "邮件");
  assert.equal(opportunitySourceLabel("Some CRM free text"), "其他");
  assert.equal(opportunitySourceLabel(null), "来源未知");
});

console.log(`  ${pass} passed`);
