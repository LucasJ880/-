/**
 * Revenue Spine — 首响 SLA 指标（computeSlaMetrics）纯函数测试，无 DB。
 *   中位数 / P90、首次回复取三种来源最早、入驻测试询盘排除、展会速记卡单列、窗口与同商机去重、
 *   未回复 vs 关闭未回复、24 小时回复率分母、工作时间口径、护栏拦截计数
 * 运行：npx tsx src/lib/revenue-spine/__tests__/sla-metrics.test.ts
 *
 * 公开仓库：只用虚构企业。
 */
import assert from "node:assert/strict";
import type { BusinessCalendar } from "../business-days";
import {
  ONBOARDING_TEST_CLOSE_REASON,
  ONBOARDING_TEST_TAG,
  ONBOARDING_TEST_UTM_SOURCE,
  clampWindowDays,
  computeSlaMetrics,
  firstResponseAt,
  isOnboardingTestInquiry,
  median,
  percentileNearestRank,
  utmSourceOf,
  type SlaMetricRow,
} from "../sla-metrics";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-24T12:00:00Z");
const SH: BusinessCalendar = { timezone: "Asia/Shanghai", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] };

let seq = 0;
function row(over: Partial<SlaMetricRow> & { inboundAt: Date }): SlaMetricRow {
  seq++;
  return {
    actionId: `act_${seq}`,
    opportunityId: `opp_${seq}`,
    source: "website_inquiry",
    actionStatus: "open",
    utmSource: null,
    customerTags: null,
    lostReason: null,
    executedReplyAts: [],
    outboundInteractionAts: [],
    outboundTradeMessageAts: [],
    guardrailBlocked: false,
    ...over,
  };
}
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const after = (d: Date, ms: number) => new Date(d.getTime() + ms);

console.log("\nsla-metrics");

ok("中位数（偶数取中间两个平均）与 P90（最近秩）", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(percentileNearestRank([40, 10, 30, 20], 0.9), 40);
  const ten = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  assert.equal(median(ten), 5.5);
  assert.equal(percentileNearestRank(ten, 0.9), 9);
  assert.equal(percentileNearestRank([7], 0.9), 7);
});

ok("首次回复 = 三种来源里询盘之后最早的；早于询盘超过 60 秒的不算", () => {
  const t = ago(10 * HOUR);
  const r = row({
    inboundAt: t,
    executedReplyAts: [after(t, 3 * HOUR)],
    outboundInteractionAts: [after(t, -2 * HOUR), after(t, 5 * HOUR)],
    outboundTradeMessageAts: [after(t, 90 * MIN)],
  });
  assert.equal(firstResponseAt(r)?.toISOString(), after(t, 90 * MIN).toISOString());
  assert.equal(firstResponseAt(row({ inboundAt: t, outboundInteractionAts: [after(t, -2 * MIN)] })), null);
  assert.equal(firstResponseAt(row({ inboundAt: t, outboundInteractionAts: [after(t, -30_000)] }))?.getTime(), t.getTime() - 30_000);
});

ok("入驻测试询盘识别：utm_source / 测试买家标记 / 测试关闭原因", () => {
  assert.equal(isOnboardingTestInquiry({ utmSource: ONBOARDING_TEST_UTM_SOURCE }), true);
  assert.equal(isOnboardingTestInquiry({ utmSource: "QINGYAN_ONBOARDING_TEST" }), true);
  assert.equal(isOnboardingTestInquiry({ customerTags: `vip, ${ONBOARDING_TEST_TAG}` }), true);
  assert.equal(isOnboardingTestInquiry({ customerTags: `${ONBOARDING_TEST_TAG}_old` }), false);
  assert.equal(isOnboardingTestInquiry({ lostReason: ONBOARDING_TEST_CLOSE_REASON }), true);
  assert.equal(isOnboardingTestInquiry({ utmSource: "google", customerTags: null, lostReason: null }), false);
  assert.equal(utmSourceOf({ meta: { utm: { source: "qingyan_onboarding_test", medium: "" } } }), "qingyan_onboarding_test");
  assert.equal(utmSourceOf({ meta: { utm: { utm_source: "newsletter" } } }), "newsletter");
  assert.equal(utmSourceOf({ meta: null }), null);
  assert.equal(utmSourceOf(null), null);
});

ok("汇总：询盘数 / 中位 / P90 / 24 小时回复率 / 未回复 / 关闭未回复；测试排除；展会单列；窗口外与重复商机不计", () => {
  seq = 0;
  const rows: SlaMetricRow[] = [];
  // 5 条已回复的网站询盘：30 / 60 / 120 / 240 / 1800 分钟（第 5 条超过 24 小时）
  for (const m of [30, 60, 120, 240, 1800]) {
    const t = ago(3 * 24 * HOUR);
    rows.push(row({ inboundAt: t, outboundInteractionAts: [after(t, m * MIN)] }));
  }
  // 未回复且行动开放（已满 24 小时）
  rows.push(row({ inboundAt: ago(2 * 24 * HOUR) }));
  // 未回复、未满 24 小时：不进 24 小时分母
  rows.push(row({ inboundAt: ago(2 * HOUR) }));
  // 关闭未回复（不合格）：不进 24 小时分母
  rows.push(row({ inboundAt: ago(2 * 24 * HOUR), actionStatus: "auto_resolved" }));
  // 入驻测试询盘 ×2：排除
  rows.push(row({ inboundAt: ago(HOUR), utmSource: ONBOARDING_TEST_UTM_SOURCE, guardrailBlocked: true }));
  rows.push(row({ inboundAt: ago(HOUR), customerTags: ONBOARDING_TEST_TAG }));
  // 展会速记卡 ×2：单列
  const b1 = ago(4 * 24 * HOUR);
  rows.push(row({ inboundAt: b1, source: "trade_show", executedReplyAts: [after(b1, 10 * HOUR)] }));
  rows.push(row({ inboundAt: ago(4 * 24 * HOUR), source: "trade_show" }));
  // 窗口外（40 天前）
  rows.push(row({ inboundAt: ago(40 * 24 * HOUR), outboundInteractionAts: [ago(39 * 24 * HOUR)] }));
  // 同一商机的第二条询盘（recreate 补建）：只算最早那条
  const dupT = ago(3 * 24 * HOUR);
  rows.push({ ...row({ inboundAt: after(dupT, HOUR) }), opportunityId: "opp_1" });

  const m = computeSlaMetrics(rows, { calendar: null, now: NOW, windowDays: 30, followUpGuardrailBlocks: 2 });
  assert.equal(m.basis, "wall_clock");
  assert.equal(m.windowDays, 30);
  assert.equal(m.excludedTests, 2);
  const q = m.inquiries;
  assert.equal(q.received, 8);
  assert.equal(q.answered, 5);
  assert.equal(q.unanswered, 2);
  assert.equal(q.closedWithoutReply, 1);
  assert.equal(q.medianFirstResponseMinutes, 120);
  assert.equal(q.p90FirstResponseMinutes, 1800);
  // 分母：5 条已回复 + 1 条已满 24 小时未回复 = 6；24 小时内回复 4 条
  assert.equal(q.within24hEligible, 6);
  assert.equal(q.answeredWithin24h, 4);
  assert.equal(q.answeredWithin24hRate, 0.667);
  assert.equal(m.tradeShow.received, 2);
  assert.equal(m.tradeShow.answered, 1);
  assert.equal(m.tradeShow.unanswered, 1);
  assert.equal(m.tradeShow.medianFirstResponseMinutes, 600);
  // 测试询盘上的护栏拦截不计；跟进草稿拦截另计
  assert.deepEqual(m.guardrail, { total: 2, firstReply: 0, followUp: 2 });
});

ok("工作时间口径：周五 17:00（上海）进来、周一 09:30 回复 = 90 分钟；24 小时回复率仍按自然时间", () => {
  seq = 100;
  const t = new Date("2026-10-16T09:00:00Z"); // 周五 17:00 上海
  const r = row({ inboundAt: t, outboundInteractionAts: [new Date("2026-10-19T01:30:00Z")] }); // 周一 09:30
  const business = computeSlaMetrics([r], { calendar: SH, now: NOW, windowDays: 30 });
  assert.equal(business.basis, "business");
  assert.equal(business.inquiries.medianFirstResponseMinutes, 90);
  assert.equal(business.inquiries.answeredWithin24h, 0);
  assert.equal(business.inquiries.within24hEligible, 1);
  const wall = computeSlaMetrics([r], { calendar: null, now: NOW, windowDays: 30 });
  assert.equal(wall.inquiries.medianFirstResponseMinutes, 3870);
});

ok("护栏拦截：真实询盘上的首封拦截计数（含展会卡）", () => {
  seq = 200;
  const rows = [
    row({ inboundAt: ago(HOUR), guardrailBlocked: true }),
    row({ inboundAt: ago(HOUR), guardrailBlocked: true, source: "trade_show" }),
    row({ inboundAt: ago(HOUR) }),
  ];
  const m = computeSlaMetrics(rows, { calendar: null, now: NOW });
  assert.deepEqual(m.guardrail, { total: 2, firstReply: 2, followUp: 0 });
  assert.equal(m.windowDays, 30);
});

ok("空数据：计数为 0、中位 / P90 / 回复率为 null", () => {
  const m = computeSlaMetrics([], { calendar: null, now: NOW, windowDays: 7 });
  assert.equal(m.inquiries.received, 0);
  assert.equal(m.inquiries.medianFirstResponseMinutes, null);
  assert.equal(m.inquiries.p90FirstResponseMinutes, null);
  assert.equal(m.inquiries.answeredWithin24hRate, null);
  assert.equal(m.from.toISOString(), new Date(NOW.getTime() - 7 * 24 * HOUR).toISOString());
});

ok("窗口天数：缺省 30、范围 1–180、非法回退默认", () => {
  assert.equal(clampWindowDays(null), 30);
  assert.equal(clampWindowDays("7"), 7);
  assert.equal(clampWindowDays("0"), 1);
  assert.equal(clampWindowDays(999), 180);
  assert.equal(clampWindowDays("abc"), 30);
});

console.log(`\nsla-metrics: ${pass} passed`);
