/**
 * KPI-1：销售期间汇总口径（spec sales/period-summary）
 * 运行：npx tsx src/lib/sales/__tests__/period-pure.test.ts
 */
import {
  addDaysYmd,
  computeSalesPeriod,
  checkPeriodRange,
  comparisonPeriod,
  defaultPeriod,
  isValidYmd,
  periodBounds,
  sameDayPrevMonth,
  stripAmountKeys,
  summarizeSalesPeriod,
} from "../period/summary-pure";
import type { PeriodQuoteRow, PeriodScope } from "../period/types";

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

const TZ = "America/Toronto";
const OCT = periodBounds("2026-10-01", "2026-10-28", TZ);
const NOW = new Date("2026-10-28T16:00:00Z");
const ORG: PeriodScope = { kind: "org" };
let seq = 0;

/** 时间写成当地（多伦多 10 月为 UTC−4） */
const edt = (local: string) => new Date(`${local}-04:00`);

function q(p: Partial<PeriodQuoteRow>): PeriodQuoteRow {
  seq++;
  return {
    id: `q${String(seq).padStart(3, "0")}`,
    opportunityId: null,
    createdById: "rep_a",
    status: "sent",
    currency: "CAD",
    sentAt: null,
    signedAt: null,
    grandTotal: 1000,
    preTaxTotal: 885,
    depositAmount: null,
    depositCollectedAt: null,
    updatedAt: edt("2026-10-20T10:00:00"),
    ...p,
  };
}

const sum = (rows: PeriodQuoteRow[], scope: PeriodScope = ORG, now = NOW) =>
  summarizeSalesPeriod({ rows, period: OCT, compare: "prev_period", scope, now });

console.log("KPI-1 日期与期间");
ok(isValidYmd("2026-10-28") && !isValidYmd("2026-02-30") && !isValidYmd("2026/10/01") && !isValidYmd("2026-13-01"), "YYYY-MM-DD 校验含月天数");
ok(isValidYmd("2024-02-29") && !isValidYmd("2026-02-29"), "闰年 2 月 29 日");
ok(addDaysYmd("2026-03-01", -1) === "2026-02-28" && addDaysYmd("2026-12-31", 1) === "2027-01-01", "日历日加减跨月跨年");
ok(checkPeriodRange("2026-10-01", "2026-10-28") === null, "合法期间");
ok(checkPeriodRange("2026-10-28", "2026-10-01") === "order", "to 早于 from → order");
ok(checkPeriodRange("2026/10/01", "2026-10-28") === "format" && checkPeriodRange(undefined, "2026-10-28") === "format", "格式错误或缺失 → format");
ok(checkPeriodRange("2025-01-01", "2025-12-31") === null && checkPeriodRange("2024-01-01", "2024-12-31") === null, "365 / 366 天（闰年）合法");
ok(checkPeriodRange("2025-01-01", "2026-01-02") === "span", "367 天 → span");
ok(checkPeriodRange("2025-01-01", "2026-06-30") === "span", "spec 场景 2025-01-01..2026-06-30 → span");
ok(OCT.days === 28 && OCT.start.toISOString() === "2026-10-01T04:00:00.000Z" && OCT.end.toISOString() === "2026-10-29T04:00:00.000Z", "10/1–10/28 多伦多边界", OCT);
const nov1 = periodBounds("2026-11-01", "2026-11-01", TZ);
ok(nov1.end.getTime() - nov1.start.getTime() === 25 * 3600_000, "夏令时结束日按 25 小时计");
const shanghai = periodBounds("2026-10-01", "2026-10-01", "Asia/Shanghai");
ok(shanghai.start.toISOString() === "2026-09-30T16:00:00.000Z", "上海时区不受多伦多写死影响");
const def = defaultPeriod(NOW, TZ);
ok(def.from === "2026-10-01" && def.to === "2026-10-28" && def.days === 28, "缺省期间 = 当地本月 1 日至今天", def);
const lateNight = defaultPeriod(new Date("2026-11-01T03:30:00Z"), TZ);
ok(lateNight.from === "2026-10-01" && lateNight.to === "2026-10-31", "UTC 已是 11 月、当地仍是 10/31 时按当地");

console.log("KPI-1 对比期");
const pp = comparisonPeriod(OCT, "prev_period");
ok(pp.from === "2026-09-03" && pp.to === "2026-09-30" && pp.days === 28, "prev_period = 紧邻之前 28 天", pp);
const pm = comparisonPeriod(OCT, "prev_month");
ok(pm.from === "2026-09-01" && pm.to === "2026-09-28", "prev_month 10/1–10/28 → 9/1–9/28", pm);
const mar31 = comparisonPeriod(periodBounds("2026-03-31", "2026-03-31", TZ), "prev_month");
ok(mar31.from === "2026-02-28" && mar31.to === "2026-02-28", "3/31 单日 → 2/28（平年）");
ok(sameDayPrevMonth("2024-03-31") === "2024-02-29" && sameDayPrevMonth("2026-01-15") === "2025-12-15", "闰年截到 2/29；1 月跨年");

console.log("KPI-1 成单口径");
{
  const rows = [
    q({ opportunityId: "o1", status: "signed", signedAt: edt("2026-10-03T10:00:00"), sentAt: edt("2026-10-02T10:00:00"), grandTotal: 1000 }),
    q({ opportunityId: "o1", status: "signed", signedAt: edt("2026-10-20T10:00:00"), sentAt: edt("2026-10-19T10:00:00"), grandTotal: 2500 }),
  ];
  const s = sum(rows);
  ok(s.totals.wonCount === 2 && s.totals.wonAmount === 3500, "同一商机两份已签报价都计", s.totals);
}
{
  const s = sum([q({ opportunityId: "o1", status: "draft", signedAt: null, sentAt: edt("2026-10-05T10:00:00") })]);
  ok(s.totals.wonCount === 0 && s.totals.quotedCount === 0, "签字后被修改回 draft 的报价不计");
}
{
  const s = sum([q({ status: "accepted", signedAt: edt("2026-10-10T10:00:00"), sentAt: edt("2026-10-09T10:00:00"), grandTotal: 5000, preTaxTotal: 4424.78 })]);
  ok(s.totals.wonAmount === 5000 && s.totals.wonPreTax === 4424.78, "成单金额取报价 grandTotal（accepted 也算），同时给税前");
}
{
  const s = sum([
    q({ status: "signed", signedAt: edt("2026-10-28T23:30:00"), grandTotal: 700 }),
    q({ status: "signed", signedAt: edt("2026-10-29T00:10:00"), grandTotal: 900 }),
  ]);
  ok(s.totals.wonCount === 1 && s.totals.wonAmount === 700, "当地 10/28 23:30 计入、10/29 00:10 不计", s.totals);
}

console.log("KPI-1 报价口径");
{
  const s = sum([
    q({ status: "expired", sentAt: edt("2026-10-02T10:00:00") }),
    q({ status: "expired", sentAt: edt("2026-10-03T10:00:00") }),
    q({ status: "rejected", sentAt: edt("2026-10-04T10:00:00") }),
    q({ status: "sent", sentAt: edt("2026-10-05T10:00:00") }),
    q({ status: "sent", sentAt: edt("2026-10-06T10:00:00") }),
    q({ status: "sent", sentAt: edt("2026-10-07T10:00:00") }),
  ]);
  ok(s.totals.quotedCount === 6 && s.totals.quotedAmount === 6000, "expired / rejected / sent 都算报出去（无商机各计）", s.totals);
}
{
  const A = q({ opportunityId: "o9", status: "sent", sentAt: edt("2026-10-05T10:00:00"), grandTotal: 1100 });
  const B = q({ opportunityId: "o9", status: "viewed", sentAt: edt("2026-10-12T10:00:00"), grandTotal: 1200 });
  const C = q({ opportunityId: "o9", status: "signed", sentAt: edt("2026-10-20T10:00:00"), signedAt: edt("2026-10-21T10:00:00"), grandTotal: 1300 });
  const s = sum([A, B, C]);
  ok(s.totals.quotedCount === 2 && s.totals.quotedAmount === 2500, "同一商机：未签修订版只计最新（B），已签每份都计（C）", s.totals);
  ok(s.totals.openQuotedCount === 1 && s.totals.openQuotedAmount === 1200, "在手未签不重复计旧修订版", s.totals);
}
{
  const t = edt("2026-10-12T10:00:00");
  const x = q({ id: "zz1", opportunityId: "o7", status: "sent", sentAt: t, updatedAt: edt("2026-10-13T10:00:00"), grandTotal: 10 });
  const y = q({ id: "zz2", opportunityId: "o7", status: "sent", sentAt: t, updatedAt: edt("2026-10-14T10:00:00"), grandTotal: 20 });
  const z1 = q({ id: "aa1", opportunityId: "o8", status: "sent", sentAt: t, updatedAt: t, grandTotal: 30 });
  const z2 = q({ id: "aa2", opportunityId: "o8", status: "sent", sentAt: t, updatedAt: t, grandTotal: 40 });
  ok(sum([x, y, z1, z2]).totals.quotedAmount === 60, "sentAt 并列取 updatedAt 大者，再并列取 id 大者");
  ok(sum([y, x, z2, z1]).totals.quotedAmount === 60, "与输入顺序无关（确定性）");
}
{
  const s = sum([]);
  ok(s.totals.quotedCount === 0 && s.totals.conversionRate === null, "报价数 0 → 转化率 null");
}
{
  const s = sum([q({ status: "signed", sentAt: null, signedAt: edt("2026-10-10T10:00:00") })]);
  ok(s.totals.wonCount === 1 && s.totals.quotedCount === 0 && s.totals.conversionRate === null, "sentAt 空的已签报价：计成单、不计报价");
  const s2 = sum([
    q({ status: "signed", sentAt: null, signedAt: edt("2026-10-10T10:00:00") }),
    q({ status: "signed", sentAt: edt("2026-10-11T10:00:00"), signedAt: edt("2026-10-12T10:00:00") }),
  ]);
  ok(s2.totals.conversionRate === 2, "同期口径下转化率可 > 1，不截断", s2.totals);
}

console.log("KPI-1 在手未签 / 定金 / 币种");
{
  const s = sum([
    q({ status: "sent", sentAt: edt("2026-10-02T10:00:00"), grandTotal: 100 }),
    q({ status: "viewed", sentAt: edt("2026-10-10T10:00:00"), grandTotal: 200 }),
    q({ status: "sent", sentAt: edt("2026-10-20T10:00:00"), grandTotal: 300 }),
    q({ status: "sent", sentAt: edt("2026-10-25T10:00:00"), grandTotal: 400 }),
    q({ status: "viewed", sentAt: edt("2026-10-27T10:00:00"), grandTotal: 500 }),
    q({ status: "rejected", sentAt: edt("2026-10-03T10:00:00"), grandTotal: 999 }),
  ]);
  ok(s.totals.openQuotedCount === 5 && s.totals.openQuotedAmount === 1500, "在手未签只含 sent / viewed", s.totals);
  ok(s.totals.staleOpenCount === 2 && s.totals.staleOpenAmount === 300, "超过 14 天的子集（10/2、10/10）", s.totals);
}
{
  const s = sum([
    q({ status: "signed", signedAt: edt("2026-09-28T10:00:00"), depositAmount: 300, depositCollectedAt: edt("2026-10-02T10:00:00") }),
    q({ status: "signed", signedAt: edt("2026-10-05T10:00:00"), depositAmount: 450.5, depositCollectedAt: edt("2026-10-06T10:00:00") }),
    q({ status: "signed", signedAt: edt("2026-10-05T10:00:00"), depositAmount: 999, depositCollectedAt: edt("2026-09-30T10:00:00") }),
  ]);
  ok(s.totals.depositAmount === 750.5, "定金按 depositCollectedAt 落在期间求和（9 月签、10 月收也算）", s.totals);
}
{
  const s = sum([
    q({ status: "signed", currency: "USD", signedAt: edt("2026-10-05T10:00:00"), grandTotal: 8000 }),
    q({ status: "signed", currency: "cad", signedAt: edt("2026-10-06T10:00:00"), grandTotal: 100 }),
    q({ status: "signed", currency: null, signedAt: edt("2026-10-07T10:00:00"), grandTotal: 50 }),
    q({ status: "signed", currency: "USD", signedAt: edt("2026-08-05T10:00:00"), grandTotal: 1 }),
  ]);
  ok(s.totals.wonCount === 2 && s.totals.wonAmount === 150 && s.totals.nonCadExcludedCount === 1, "USD 报价不汇总且 nonCadExcludedCount 计 1；大小写与空值按 CAD", s.totals);
}
{
  const s = sum([
    q({ status: "signed", signedAt: edt("2026-10-05T10:00:00"), grandTotal: 0.1 }),
    q({ status: "signed", signedAt: edt("2026-10-06T10:00:00"), grandTotal: 0.2 }),
  ]);
  ok(s.totals.wonAmount === 0.3, "金额按分取整，无浮点尾差", s.totals.wonAmount);
}

{
  const s = sum([
    q({ status: "signed", signedAt: edt("2026-10-05T10:00:00"), grandTotal: 100, depositAmount: 30, depositCollectedAt: edt("2026-10-05T12:00:00") }),
    q({ status: "signed", signedAt: edt("2026-10-06T10:00:00"), grandTotal: 200 }),
    q({ status: "signed", signedAt: edt("2026-10-07T10:00:00"), grandTotal: 300 }),
    q({ status: "accepted", signedAt: edt("2026-10-08T10:00:00"), grandTotal: 400 }),
  ]);
  ok(s.totals.wonCount === 4 && s.totals.wonWithoutDepositCount === 3 && s.totals.wonWithoutDepositAmount === 900, "已签未登记定金：4 份成单中 3 份", s.totals);
}

console.log("KPI-1 范围 / 按人 / 对比");
{
  const rows = [
    q({ createdById: "rep_a", status: "signed", signedAt: edt("2026-10-05T10:00:00"), sentAt: edt("2026-10-04T10:00:00"), grandTotal: 1000 }),
    q({ createdById: "rep_b", status: "signed", signedAt: edt("2026-10-06T10:00:00"), sentAt: edt("2026-10-05T10:00:00"), grandTotal: 3000 }),
    q({ createdById: "rep_b", status: "sent", sentAt: edt("2026-10-07T10:00:00"), grandTotal: 500 }),
  ];
  const names = new Map([["rep_a", "Alex"], ["rep_b", "Bea"]]);
  const org = summarizeSalesPeriod({ rows, period: OCT, compare: "prev_period", scope: ORG, now: NOW, names });
  ok(org.scope === "org" && org.byRep.length === 2 && org.byRep[0].userId === "rep_b" && org.byRep[0].name === "Bea", "全企业 byRep 按成单金额降序", org.byRep);
  ok(org.byRep[0].quotedCount === 2 && org.byRep[0].conversionRate === 0.5, "按人转化率", org.byRep[0]);
  const own = summarizeSalesPeriod({ rows, period: OCT, compare: "prev_period", scope: { kind: "own", userId: "rep_a" }, now: NOW, names });
  ok(own.scope === "own" && own.totals.wonAmount === 1000 && own.byRep.length === 1 && own.byRep[0].userId === "rep_a", "own 范围只含本人", own);
  ok(!JSON.stringify(own).includes("Bea") && !JSON.stringify(own).includes("3000"), "own 范围结果不含他人姓名与金额");
  const nobody = summarizeSalesPeriod({ rows, period: OCT, compare: "prev_period", scope: { kind: "own", userId: "rep_c" }, now: NOW, names });
  ok(nobody.byRep.length === 1 && nobody.byRep[0].wonCount === 0 && nobody.byRep[0].name === "（已移除用户）", "own 范围本人无数据也有一行");
}
{
  const rows = [
    q({ status: "signed", signedAt: edt("2026-10-05T10:00:00"), grandTotal: 1200 }),
    q({ status: "signed", signedAt: new Date("2026-09-10T14:00:00Z"), grandTotal: 1000 }),
  ];
  const s = sum(rows);
  ok(s.comparison.kind === "prev_period" && s.comparison.totals.wonAmount === 1000, "对比期同口径汇总", s.comparison.totals);
  ok(Math.abs((s.comparison.delta.wonAmount ?? 0) - 0.2) < 1e-9, "变化率 (1200−1000)/1000 = 0.2");
  ok(s.comparison.delta.quotedAmount === null, "对比期为 0 → 变化率 null");
  const comp = computeSalesPeriod({ rows: [q({ createdById: "rep_x", status: "sent", sentAt: new Date("2026-09-10T14:00:00Z") })], period: OCT, compare: "prev_period", scope: ORG, now: NOW });
  ok(comp.prevByRep.length === 1 && comp.prevByRep[0].quotedCount === 1 && comp.summary.byRep.length === 0, "上一期按人另算（I5 用），不进入 summary", comp.prevByRep);
  ok(!("prevByRep" in comp.summary), "summary 不含 prevByRep");
  ok(s.truncated === false && summarizeSalesPeriod({ rows, period: OCT, compare: "prev_month", scope: ORG, now: NOW, truncated: true }).truncated === true, "truncated 透传");
}
{
  const stripped = stripAmountKeys({ wonCount: 1, wonAmount: 2, wonPreTax: 3, quotedCount: 4, depositAmount: 5, conversionRate: 0.5 });
  ok(JSON.stringify(stripped) === JSON.stringify({ wonCount: 1, quotedCount: 4, conversionRate: 0.5 }), "决定 B：剔除 *Amount / *PreTax 键", stripped);
}

console.log(`\nKPI-1 period-pure: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
