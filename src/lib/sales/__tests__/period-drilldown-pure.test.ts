/**
 * STAT-1：周预设与按人报价明细（spec sales/period-summary"看板展示""按人报价明细"）
 * 运行：npx tsx src/lib/sales/__tests__/period-drilldown-pure.test.ts
 */
import { periodBounds, periodRepQuotes, summarizeSalesPeriod, weekPresetRange, weekStartYmd } from "../period/summary-pure";
import type { PeriodQuoteRow } from "../period/types";

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

console.log("\n[1] 一周从周一开始");
const cases: Array<[string, string]> = [
  ["2026-10-26", "2026-10-26"], // 周一
  ["2026-10-28", "2026-10-26"], // 周三
  ["2026-11-01", "2026-10-26"], // 周日 → 上一个周一（跨月）
  ["2027-01-02", "2026-12-28"], // 周六（跨年）
  ["2028-03-01", "2028-02-28"], // 闰年
];
for (const [day, monday] of cases) ok(weekStartYmd(day) === monday, `${day} → 周一 ${monday}`, weekStartYmd(day));
const tw = weekPresetRange("2026-10-28", "this_week");
const lw = weekPresetRange("2026-10-28", "last_week");
ok(tw.from === "2026-10-26" && tw.to === "2026-10-28", "周三打开「本周」= 本周一至今天", tw);
ok(lw.from === "2026-10-19" && lw.to === "2026-10-25", "「上周」= 上周一至上周日", lw);
const twMon = weekPresetRange("2026-10-26", "this_week");
ok(twMon.from === "2026-10-26" && twMon.to === "2026-10-26", "周一打开「本周」只有今天");
const lwJan = weekPresetRange("2027-01-02", "last_week");
ok(lwJan.from === "2026-12-21" && lwJan.to === "2026-12-27", "跨年的上周", lwJan);

console.log("\n[2] 明细与按人表同一口径");
const TZ = "America/Toronto";
const OCT = periodBounds("2026-10-01", "2026-10-28", TZ);
const edt = (local: string) => new Date(`${local}-04:00`);
let seq = 0;
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
const rows: PeriodQuoteRow[] = [
  q({ sentAt: edt("2026-10-05T10:00:00"), grandTotal: 1200 }),
  q({ sentAt: edt("2026-10-06T10:00:00"), grandTotal: 800 }),
  q({ status: "signed", sentAt: edt("2026-09-20T10:00:00"), signedAt: edt("2026-10-10T10:00:00"), grandTotal: 5000 }),
  q({ status: "draft", grandTotal: 999 }),
  // 同商机两份未签修订：只计最新一份
  q({ opportunityId: "opp1", sentAt: edt("2026-10-07T10:00:00"), grandTotal: 300 }),
  q({ opportunityId: "opp1", sentAt: edt("2026-10-09T10:00:00"), grandTotal: 350 }),
  // 非 CAD、跨期
  q({ currency: "USD", sentAt: edt("2026-10-08T10:00:00"), grandTotal: 700 }),
  q({ sentAt: edt("2026-09-08T10:00:00"), grandTotal: 400 }),
  // 他人
  q({ createdById: "rep_b", sentAt: edt("2026-10-05T10:00:00"), grandTotal: 2222 }),
  q({ createdById: "rep_b", status: "accepted", sentAt: edt("2026-10-05T10:00:00"), signedAt: edt("2026-10-06T10:00:00"), grandTotal: 3333 }),
];
const summary = summarizeSalesPeriod({ rows, period: OCT, compare: "prev_period", scope: { kind: "org" }, now: new Date("2026-10-28T16:00:00Z") });
for (const repId of ["rep_a", "rep_b"]) {
  const d = periodRepQuotes(rows, OCT, repId);
  const row = summary.byRep.find((r) => r.userId === repId)!;
  const amt = (xs: PeriodQuoteRow[]) => Math.round(xs.reduce((s, r) => s + r.grandTotal, 0) * 100) / 100;
  ok(d.won.length === row.wonCount && amt(d.won) === row.wonAmount, `${repId}：成单条数 / 金额 = 按人表（${row.wonCount} / ${row.wonAmount}）`, { won: d.won.map((r) => r.id), row });
  ok(d.quoted.length === row.quotedCount && amt(d.quoted) === row.quotedAmount, `${repId}：报价条数 / 金额 = 按人表（${row.quotedCount} / ${row.quotedAmount}）`, { quoted: d.quoted.map((r) => r.id), row });
  ok([...d.won, ...d.quoted].every((r) => r.createdById === repId), `${repId}：明细只含本人的报价`);
}
const a = periodRepQuotes(rows, OCT, "rep_a");
ok(!a.quoted.some((r) => r.status === "draft") && !a.won.some((r) => r.status === "draft"), "草稿不出现");
ok(a.quoted.filter((r) => r.opportunityId === "opp1").length === 1 && a.quoted.some((r) => r.grandTotal === 350), "同商机未签修订只出现最新一份");
ok(!a.quoted.some((r) => r.currency === "USD") && !a.quoted.some((r) => r.grandTotal === 400), "非 CAD、跨期不出现");
ok(a.won.length === 1 && a.won[0].grandTotal === 5000, "上月发送、本月签字的报价只在成单组");
const none = periodRepQuotes(rows, OCT, "rep_nobody");
ok(none.won.length === 0 && none.quoted.length === 0, "没有报价的人返回空");

console.log(`\nSTAT-1 period-drilldown-pure: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
