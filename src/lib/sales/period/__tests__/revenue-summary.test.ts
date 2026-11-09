/**
 * OPS-REV：运营中心「全公司销售额」汇总（纯函数）+ 岗位模板绑定。
 * 运行：npx tsx src/lib/sales/period/__tests__/revenue-summary.test.ts
 */
import assert from "node:assert/strict";
import { buildOrgRevenueSummary, revenueSummaryFetchRange, revenueSummaryWindows } from "../revenue-summary-pure";
import { computeSalesPeriod, periodBounds } from "../summary-pure";
import type { PeriodQuoteRow } from "../types";
import { SYSTEM_ROLE_PROFILES, WINDOW_COVERING_ROLE_PROFILES } from "@/lib/authorization/role-defaults";
import { getPermissionDefinition, isKnownPermission } from "@/lib/authorization/permissions";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const TZ = "America/Toronto";
/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`);
const NOW = edt("2026-10-15T12:00:00"); // 周四

let seq = 0;
function row(p: Partial<PeriodQuoteRow>): PeriodQuoteRow {
  seq++;
  return {
    id: `q${seq}`,
    opportunityId: null,
    createdById: "rep_a",
    status: "sent",
    currency: "CAD",
    sentAt: null,
    signedAt: null,
    grandTotal: 0,
    preTaxTotal: 0,
    depositAmount: null,
    depositCollectedAt: null,
    updatedAt: NOW,
    ...p,
  } as PeriodQuoteRow;
}

const ROWS: PeriodQuoteRow[] = [
  // 本周签约（10-13），10-12 发出
  row({ status: "signed", sentAt: edt("2026-10-12T09:00:00"), signedAt: edt("2026-10-13T10:00:00"), grandTotal: 1000, createdById: "rep_a" }),
  // 本月早些时候签约（10-03），10-02 发出
  row({ status: "signed", sentAt: edt("2026-10-02T09:00:00"), signedAt: edt("2026-10-03T10:00:00"), grandTotal: 2000, createdById: "rep_b" }),
  // 本周发出未签
  row({ status: "sent", sentAt: edt("2026-10-14T09:00:00"), grandTotal: 500, createdById: "rep_b" }),
  // 草稿不计
  row({ status: "draft", sentAt: edt("2026-10-14T09:00:00"), grandTotal: 7777 }),
  // 非 CAD 不计金额
  row({ status: "signed", currency: "USD", sentAt: edt("2026-10-14T09:00:00"), signedAt: edt("2026-10-14T10:00:00"), grandTotal: 8888 }),
  // 上月签约不计
  row({ status: "signed", sentAt: edt("2026-09-29T09:00:00"), signedAt: edt("2026-09-30T10:00:00"), grandTotal: 6666 }),
];

ok("窗口：本周 = 本周一至今天，本月至今 = 1 日至今天（组织时区）", () => {
  const w = revenueSummaryWindows(NOW, TZ);
  assert.equal(w.thisWeek.from, "2026-10-12");
  assert.equal(w.thisWeek.to, "2026-10-15");
  assert.equal(w.monthToDate.from, "2026-10-01");
  assert.equal(w.monthToDate.to, "2026-10-15");
});

ok("跨月的周：取数区间从本周一开始（早于本月 1 日）", () => {
  const now = edt("2026-10-01T12:00:00"); // 周四，本周一是 9-28
  const w = revenueSummaryWindows(now, TZ);
  assert.equal(w.thisWeek.from, "2026-09-28");
  assert.equal(w.monthToDate.from, "2026-10-01");
  const r = revenueSummaryFetchRange(w);
  assert.equal(r.start.getTime(), w.thisWeek.start.getTime());
  assert.equal(r.end.getTime(), w.monthToDate.end.getTime());
});

ok("数字：本周成单 1 单 $1,000、报价 $1,500；本月成单 2 单 $3,000、报价 $3,500；草稿 / 上月 / 非 CAD 不计", () => {
  const s = buildOrgRevenueSummary({ rows: ROWS, now: NOW, timezone: TZ, truncated: false });
  assert.deepEqual(s.thisWeek, { from: "2026-10-12", to: "2026-10-15", wonAmount: 1000, wonCount: 1, quotedAmount: 1500, quotedCount: 2 });
  assert.deepEqual(s.monthToDate, { from: "2026-10-01", to: "2026-10-15", wonAmount: 3000, wonCount: 2, quotedAmount: 3500, quotedCount: 3 });
  assert.equal(s.nonCadExcludedCount, 1);
  assert.equal(s.currency, "CAD");
  assert.equal(s.truncated, false);
});

ok("与销售期间汇总（全企业）同一口径：本月数字与 computeSalesPeriod 一致", () => {
  const s = buildOrgRevenueSummary({ rows: ROWS, now: NOW, timezone: TZ, truncated: false });
  const { summary } = computeSalesPeriod({ rows: ROWS, period: periodBounds("2026-10-01", "2026-10-15", TZ), compare: "prev_period", scope: { kind: "org" }, now: NOW });
  assert.equal(s.monthToDate.wonAmount, summary.totals.wonAmount);
  assert.equal(s.monthToDate.wonCount, summary.totals.wonCount);
  assert.equal(s.monthToDate.quotedAmount, summary.totals.quotedAmount);
});

ok("只输出白名单字段：没有按销售员明细、客户、报价 id", () => {
  const s = buildOrgRevenueSummary({ rows: ROWS, now: NOW, timezone: TZ, truncated: true });
  assert.deepEqual(Object.keys(s).sort(), ["currency", "monthToDate", "nonCadExcludedCount", "thisWeek", "timezone", "truncated"]);
  for (const w of [s.thisWeek, s.monthToDate]) {
    assert.deepEqual(Object.keys(w).sort(), ["from", "quotedAmount", "quotedCount", "to", "wonAmount", "wonCount"]);
  }
  const json = JSON.stringify(s);
  assert.ok(!json.includes("rep_a") && !json.includes("rep_b") && !/"q\d+"/.test(json));
  assert.equal(s.truncated, true);
});

ok("没有报价：全部为 0", () => {
  const s = buildOrgRevenueSummary({ rows: [], now: NOW, timezone: TZ, truncated: false });
  assert.equal(s.thisWeek.wonAmount + s.thisWeek.quotedAmount + s.monthToDate.wonCount, 0);
});

ok("权限键登记：sales.revenue.summary.read 只支持全企业范围", () => {
  assert.ok(isKnownPermission("sales.revenue.summary.read"));
  assert.deepEqual(getPermissionDefinition("sales.revenue.summary.read")?.supportedScopes, ["ORG"]);
});

const wc = (key: string) => WINDOW_COVERING_ROLE_PROFILES.find((p) => p.key === key)?.bindings ?? [];
const sys = (key: string) => SYSTEM_ROLE_PROFILES.find((p) => p.key === key)?.bindings ?? [];
const has = (bindings: { permissionKey: string; dataScope: string }[], key: string) => bindings.some((b) => b.permissionKey === key && b.dataScope === "ORG");

ok("窗饰运营主管、运营人员绑定销售额汇总（ORG）；不多拿任何其他销售权限", () => {
  for (const key of ["ops_lead", "ops_staff"]) {
    const all = [...sys(key), ...wc(key)];
    assert.ok(has(all, "sales.revenue.summary.read"), key);
    assert.deepEqual(all.filter((b) => b.permissionKey.startsWith("sales.") && b.permissionKey !== "sales.revenue.summary.read"), [], key);
  }
});

ok("销售人员、招投标、出单、安装工不绑定销售额汇总", () => {
  for (const key of ["sales_rep", "bids", "fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades", "installer"]) {
    assert.ok(![...sys(key), ...wc(key)].some((b) => b.permissionKey === "sales.revenue.summary.read"), key);
  }
});

console.log(`\n${pass} passed`);
