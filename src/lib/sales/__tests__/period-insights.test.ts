/**
 * KPI-1：期间汇总确定性洞察（spec sales/period-summary"确定性洞察""销售范围不输出团队洞察"）
 * 运行：npx tsx src/lib/sales/__tests__/period-insights.test.ts
 */
import { buildPeriodInsights, INSIGHT_RULES, INSIGHT_THRESHOLDS } from "../period/insights";
import type { PeriodCalendarStats, PeriodRepRow, PeriodSummary, PeriodTotals } from "../period/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const ZERO: PeriodTotals = {
  wonCount: 0,
  wonAmount: 0,
  wonPreTax: 0,
  quotedCount: 0,
  quotedAmount: 0,
  conversionRate: null,
  openQuotedCount: 0,
  openQuotedAmount: 0,
  staleOpenCount: 0,
  staleOpenAmount: 0,
  depositAmount: 0,
  wonWithoutDepositCount: 0,
  wonWithoutDepositAmount: 0,
  nonCadExcludedCount: 0,
};
const INFO = { from: "2026-10-01", to: "2026-10-28", days: 28, timezone: "America/Toronto" };
const rep = (userId: string, name: string, p: Partial<PeriodRepRow> = {}): PeriodRepRow => ({
  userId, name, wonCount: 0, wonAmount: 0, quotedCount: 0, quotedAmount: 0, conversionRate: null, ...p,
});

function summary(cur: Partial<PeriodTotals> = {}, prev: Partial<PeriodTotals> = {}, opts: { scope?: "org" | "own"; byRep?: PeriodRepRow[] } = {}): PeriodSummary {
  return {
    period: INFO,
    scope: opts.scope ?? "org",
    totals: { ...ZERO, ...cur },
    comparison: { kind: "prev_period", period: { ...INFO, from: "2026-09-03", to: "2026-09-30" }, totals: { ...ZERO, ...prev }, delta: {} as never },
    byRep: opts.byRep ?? [],
    truncated: false,
  };
}
const run = (s: PeriodSummary, prevByRep: PeriodRepRow[] = [], calendar: PeriodCalendarStats | null = null) =>
  buildPeriodInsights({ summary: s, prevByRep, calendar });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);
const has = (xs: { code: string }[], c: string) => codes(xs).includes(c);

console.log("KPI-1 洞察规则表");
ok(INSIGHT_RULES.length === 9, "规则表恰为九条");
ok(JSON.stringify(codes(INSIGHT_RULES)) === JSON.stringify(["I1_WON_DELTA", "I2_QUOTED_DELTA", "I3_STALE_OPEN", "I4_LOW_CONVERSION", "I5_REP_SILENT", "I6_REP_CONCENTRATION", "I7_DEPOSIT_GAP", "I8_CAL_UNKNOWN", "I9_CAL_WEBSITE_SHARE"]), "规则码与顺序");

console.log("I1 成单金额环比");
{
  const up = run(summary({ wonAmount: 63000 }, { wonAmount: 51900 }));
  const i1 = up.find((x) => x.code === "I1_WON_DELTA");
  ok(!!i1 && i1.severity === "info" && i1.evidence.wonAmount === 63000 && i1.evidence.prevWonAmount === 51900, "63,000 对 51,900（+21.4%）触发 info", i1);
  ok(!has(run(summary({ wonAmount: 61230 }, { wonAmount: 51900 })), "I1_WON_DELTA"), "61,230 对 51,900（+18.0%）不触发");
  ok(has(run(summary({ wonAmount: 120 }, { wonAmount: 100 })), "I1_WON_DELTA"), "恰 +20% 触发（边界）");
  const down = run(summary({ wonAmount: 70 }, { wonAmount: 100 })).find((x) => x.code === "I1_WON_DELTA");
  ok(!!down && down.severity === "warn", "−30% 触发 warn");
  ok(!has(run(summary({ wonAmount: 5000 }, { wonAmount: 0 })), "I1_WON_DELTA"), "对比期为 0 不触发");
}

console.log("I2 报价金额环比");
ok(has(run(summary({ quotedAmount: 50 }, { quotedAmount: 100 })), "I2_QUOTED_DELTA"), "−50% 触发");
ok(!has(run(summary({ quotedAmount: 110 }, { quotedAmount: 100 })), "I2_QUOTED_DELTA"), "+10% 不触发");
ok(!has(run(summary({ quotedAmount: 110 }, { quotedAmount: 0 })), "I2_QUOTED_DELTA"), "对比期为 0 不触发");

console.log("I3 超 14 天未签");
ok(has(run(summary({ openQuotedAmount: 70100, staleOpenCount: 6, staleOpenAmount: 19800 })), "I3_STALE_OPEN"), "条数 6 ≥ 5 触发（金额占比 28%）");
ok(has(run(summary({ openQuotedAmount: 1000, staleOpenCount: 1, staleOpenAmount: 300 })), "I3_STALE_OPEN"), "金额占比恰 30% 触发（边界）");
ok(!has(run(summary({ openQuotedAmount: 1000, staleOpenCount: 4, staleOpenAmount: 299 })), "I3_STALE_OPEN"), "4 条且 29.9% 不触发");
ok(!has(run(summary({ openQuotedAmount: 1000 })), "I3_STALE_OPEN"), "没有超期不触发");

console.log("I4 转化率偏低");
ok(has(run(summary({ quotedCount: 10, wonCount: 2, conversionRate: 0.2 })), "I4_LOW_CONVERSION"), "10 份报价、20% 触发（边界条数）");
ok(!has(run(summary({ quotedCount: 9, wonCount: 1, conversionRate: 1 / 9 })), "I4_LOW_CONVERSION"), "9 份报价不触发");
ok(!has(run(summary({ quotedCount: 10, wonCount: 3, conversionRate: 0.3 })), "I4_LOW_CONVERSION"), "恰 30% 不触发（边界）");

console.log("I5 某销售本期零报价");
{
  const prev = [rep("u1", "Alex", { quotedCount: 4 }), rep("u2", "Bea", { quotedCount: 2 })];
  const cur = [rep("u2", "Bea", { quotedCount: 1 })];
  const hit = run(summary({}, {}, { byRep: cur }), prev).find((x) => x.code === "I5_REP_SILENT");
  ok(!!hit && hit.text.includes("Alex") && !hit.text.includes("Bea"), "上一期 4 份、本期 0 份触发", hit);
  ok(!has(run(summary({}, {}, { byRep: [rep("u1", "Alex", { quotedCount: 1 })] }), [rep("u1", "Alex", { quotedCount: 4 })]), "I5_REP_SILENT"), "本期仍有报价不触发");
  ok(!has(run(summary({}, {}, { byRep: [] }), [rep("u1", "Alex", { quotedCount: 0, wonCount: 1 })]), "I5_REP_SILENT"), "上一期也没报价不触发（边界）");
}

console.log("I6 成单集中");
{
  const byRep = [rep("u1", "Alex", { wonAmount: 600, wonCount: 3 }), rep("u2", "Bea", { wonAmount: 400, wonCount: 2 })];
  ok(has(run(summary({ wonCount: 5, wonAmount: 1000 }, {}, { byRep })), "I6_REP_CONCENTRATION"), "60%、成单 5 触发（双边界）");
  ok(!has(run(summary({ wonCount: 4, wonAmount: 1000 }, {}, { byRep })), "I6_REP_CONCENTRATION"), "成单 4 不触发");
  const even = [rep("u1", "Alex", { wonAmount: 590 }), rep("u2", "Bea", { wonAmount: 410 })];
  ok(!has(run(summary({ wonCount: 5, wonAmount: 1000 }, {}, { byRep: even })), "I6_REP_CONCENTRATION"), "59% 不触发");
}

console.log("I7 已签未登记定金");
ok(has(run(summary({ wonWithoutDepositCount: 3, wonWithoutDepositAmount: 900 })), "I7_DEPOSIT_GAP"), "3 份触发（边界）");
ok(!has(run(summary({ wonWithoutDepositCount: 2, wonWithoutDepositAmount: 600 })), "I7_DEPOSIT_GAP"), "2 份不触发");
ok(!has(run(summary()), "I7_DEPOSIT_GAP"), "0 份不触发");

console.log("I8 / I9 日程");
{
  const cal = (b: Partial<PeriodCalendarStats["bySource"]>): PeriodCalendarStats => ({ bySource: { qingyan: 0, member: 0, website: 0, unknown: 0, ...b } });
  ok(has(run(summary(), [], cal({ member: 5, unknown: 1 })), "I8_CAL_UNKNOWN"), "不明来源 1 条触发");
  ok(!has(run(summary(), [], cal({ member: 5 })), "I8_CAL_UNKNOWN"), "不明来源 0 条不触发");
  ok(has(run(summary(), [], cal({ website: 4, member: 6 })), "I9_CAL_WEBSITE_SHARE"), "网站恰 40% 触发（边界）");
  ok(!has(run(summary(), [], cal({ website: 3, member: 7 })), "I9_CAL_WEBSITE_SHARE"), "网站 30% 不触发");
  const none = run(summary(), [], null);
  ok(!has(none, "I8_CAL_UNKNOWN") && !has(none, "I9_CAL_WEBSITE_SHARE"), "calendar = null 不出 I8 / I9");
}

console.log("范围过滤");
{
  const byRep = [rep("u1", "Alex", { wonAmount: 900, wonCount: 5, quotedCount: 0 })];
  const prev = [rep("u1", "Alex", { quotedCount: 3 }), rep("u9", "Zed", { quotedCount: 2 })];
  const cal: PeriodCalendarStats = { bySource: { qingyan: 0, member: 1, website: 9, unknown: 2 } };
  const cur: Partial<PeriodTotals> = { wonCount: 5, wonAmount: 900, wonWithoutDepositCount: 3, wonWithoutDepositAmount: 500, quotedCount: 12, conversionRate: 0.1 };
  const orgOut = run(summary(cur, {}, { byRep }), prev, cal);
  ok(["I4_LOW_CONVERSION", "I5_REP_SILENT", "I6_REP_CONCENTRATION", "I7_DEPOSIT_GAP", "I8_CAL_UNKNOWN", "I9_CAL_WEBSITE_SHARE"].every((c) => has(orgOut, c)), "全企业范围：团队与日程洞察都出", codes(orgOut));
  const ownOut = run(summary(cur, {}, { scope: "own", byRep }), prev, cal);
  ok(!has(ownOut, "I5_REP_SILENT") && !has(ownOut, "I6_REP_CONCENTRATION"), "销售范围不出 I5 / I6", codes(ownOut));
  ok(!has(ownOut, "I8_CAL_UNKNOWN") && !has(ownOut, "I9_CAL_WEBSITE_SHARE"), "销售范围不出企业级日程洞察");
  ok(has(ownOut, "I4_LOW_CONVERSION") && has(ownOut, "I7_DEPOSIT_GAP"), "销售范围仍出本人 I4 / I7");
  ok(!JSON.stringify(ownOut).includes("Zed"), "销售范围洞察不含他人姓名");
  ok(JSON.stringify(run(summary(cur, {}, { byRep }), prev, cal)) === JSON.stringify(orgOut), "同样输入同样输出");
}
ok(INSIGHT_THRESHOLDS.deltaRatio === 0.2 && INSIGHT_THRESHOLDS.staleCount === 5, "阈值集中定义");

console.log(`\nKPI-1 period-insights: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
