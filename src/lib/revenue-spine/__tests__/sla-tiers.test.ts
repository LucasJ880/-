/**
 * Revenue Spine — 工作时间日历 / SLA 策略字段合并 / 首响分级提醒决策。纯函数，无 DB。
 *   [1] 日历为 null：addBusinessHours / addBusinessDays 与 V1（UTC 周一至周五）逐位一致
 *   [2] 组织工作时间：时段内计时、跨周末、早于上班、"24:00"、工作日自定义；夏令时（多伦多 / 悉尼）切换周末
 *   [3] 策略合并：默认全 null；合法值、显式 null、非法值保留原值、上限；工作时间校验；合并结果再合并不丢字段
 *   [4] Next action：回复类到期按组织工作时间；未配置时与旧口径一致
 *   [5] 分级决策：自然时间 / 工作时间（含夏令时）、已回复不发、错过太久不补发、幂等键、正文不含买家邮箱电话；
 *       第一档按实际草稿状态措辞；旧线程提醒的分工（跟踪中 / 这次进线就是分级询盘 → 跳过，询盘之后再来信 → 照常）
 * 运行：npx tsx src/lib/revenue-spine/__tests__/sla-tiers.test.ts
 *
 * 公开仓库：只用虚构企业。
 */
import assert from "node:assert/strict";
import {
  addBusinessDays,
  addBusinessHours,
  addSlaMinutes,
  slaMinutesBetween,
  zonedLocalToUtc,
  type BusinessCalendar,
} from "../business-days";
import { computeNextAction } from "../next-action";
import {
  DEFAULT_REVENUE_SPINE_POLICY,
  mergeRevenueSpinePolicy,
  parseBusinessCalendar,
  slaTiersEnabled,
  type RevenueSpinePolicy,
} from "../policy";
import {
  SLA_TIER_MAX_LATE_MS,
  decideSlaTiers,
  describeDraftState,
  formatSlaTierMessage,
  formatThreshold,
  hasResponseSince,
  slaTierSourceKey,
  slaTierThresholds,
} from "../sla-tiers";
import { guardrailMarkerPatch } from "../fde/inbound-sales";
import { threadsOwnedByTiers } from "@/lib/trade/inquiry-sla";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (d: Date) => d.toISOString();
const SH: BusinessCalendar = { timezone: "Asia/Shanghai", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] };
const TOR: BusinessCalendar = { timezone: "America/Toronto", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] };
const SYD: BusinessCalendar = { timezone: "Australia/Sydney", start: "09:00", end: "17:00", workdays: [1, 2, 3, 4, 5] };

console.log("\n[1] 日历为 null = V1 口径逐位不变");

ok("addBusinessHours(x, h) 与 addBusinessHours(x, h, null / undefined) 完全相同（含周末起点、小数小时）", () => {
  const starts = [
    "2026-09-07T08:00:00Z", // 周一
    "2026-09-11T20:00:00Z", // 周五晚
    "2026-09-12T10:30:00Z", // 周六
    "2026-09-13T23:59:59.999Z", // 周日最后一毫秒
    "2026-10-30T21:50:00Z",
  ].map((s) => new Date(s));
  for (const s of starts) {
    for (const h of [0, 0.25, 1, 4, 7.5, 8, 24, 40, 100]) {
      const legacy = addBusinessHours(s, h);
      assert.equal(iso(addBusinessHours(s, h, null)), iso(legacy));
      assert.equal(iso(addBusinessHours(s, h, undefined)), iso(legacy));
    }
    for (const d of [0, 1, 2, 3, 5, 10]) assert.equal(iso(addBusinessDays(s, d, null)), iso(addBusinessDays(s, d)));
  }
  // scoring-draft 测试钉住的值
  const fri = new Date("2026-09-11T20:00:00Z");
  assert.equal(iso(addBusinessHours(fri, 8, null)), "2026-09-14T04:00:00.000Z");
  assert.equal(addBusinessDays(fri, 1, null).toISOString().slice(0, 10), "2026-09-14");
});

ok("SLA 口径无日历 = 自然时间（不是 UTC 工作日）", () => {
  const sat = new Date("2026-09-12T10:00:00Z");
  assert.equal(iso(addSlaMinutes(sat, 15, null)), "2026-09-12T10:15:00.000Z");
  assert.equal(slaMinutesBetween(sat, new Date("2026-09-12T12:00:00Z"), null), 120);
  assert.equal(slaMinutesBetween(sat, new Date("2026-09-12T09:00:00Z"), null), 0);
});

console.log("\n[2] 组织工作时间");

ok("上海 09:00–18:00 周一至周五：时段内 / 跨周末 / 周末起点 / 早于上班", () => {
  // 周一 10:00 当地 = 02:00Z，+4h → 14:00 当地
  assert.equal(iso(addBusinessHours(new Date("2026-09-07T02:00:00Z"), 4, SH)), "2026-09-07T06:00:00.000Z");
  // 周五 17:00 当地（09:00Z）+4h → 周五 1h + 周一 3h = 周一 12:00 当地（04:00Z）
  assert.equal(iso(addBusinessHours(new Date("2026-09-11T09:00:00Z"), 4, SH)), "2026-09-14T04:00:00.000Z");
  // 周六 + 1h → 周一 10:00 当地
  assert.equal(iso(addBusinessHours(new Date("2026-09-12T03:00:00Z"), 1, SH)), "2026-09-14T02:00:00.000Z");
  // 周一 07:00 当地（前一天 23:00Z）+1h → 10:00 当地
  assert.equal(iso(addBusinessHours(new Date("2026-09-06T23:00:00Z"), 1, SH)), "2026-09-07T02:00:00.000Z");
  // 恰好用完当天：周一 17:00 + 1h = 18:00 当天
  assert.equal(iso(addBusinessHours(new Date("2026-09-07T09:00:00Z"), 1, SH)), "2026-09-07T10:00:00.000Z");
  // 0 小时 = 落到下一个工作时刻
  assert.equal(iso(addBusinessHours(new Date("2026-09-12T03:00:00Z"), 0, SH)), "2026-09-14T01:00:00.000Z");
});

ok("工作时间内经过的分钟：周五 17:00 → 周一 09:30 = 90 分钟", () => {
  assert.equal(slaMinutesBetween(new Date("2026-09-11T09:00:00Z"), new Date("2026-09-14T01:30:00Z"), SH), 90);
  // 周末内部 = 0
  assert.equal(slaMinutesBetween(new Date("2026-09-12T02:00:00Z"), new Date("2026-09-13T10:00:00Z"), SH), 0);
});

ok("自定义工作日（周一至周六）与 24:00 结束", () => {
  const sixDays: BusinessCalendar = { ...SH, workdays: [1, 2, 3, 4, 5, 6] };
  // 周五 17:00 + 4h → 周五 1h + 周六 3h = 周六 12:00 当地
  assert.equal(iso(addBusinessHours(new Date("2026-09-11T09:00:00Z"), 4, sixDays)), "2026-09-12T04:00:00.000Z");
  const allDay: BusinessCalendar = { timezone: "Asia/Shanghai", start: "00:00", end: "24:00", workdays: [1, 2, 3, 4, 5, 6, 7] };
  const t = new Date("2026-09-12T03:00:00Z");
  assert.equal(iso(addBusinessHours(t, 30, allDay)), iso(new Date(t.getTime() + 30 * HOUR)));
});

ok("addBusinessDays 带日历：按当地工作日、保持当地钟点", () => {
  // 周五 10:00 上海 + 1 工作日 → 周一 10:00
  assert.equal(iso(addBusinessDays(new Date("2026-09-11T02:00:00Z"), 1, SH)), "2026-09-14T02:00:00.000Z");
  assert.equal(iso(addBusinessDays(new Date("2026-09-11T02:00:00Z"), 0, SH)), "2026-09-11T02:00:00.000Z");
});

ok("夏令时：多伦多回拨周末（2026-11-01）与拨快周末（2027-03-14），周五 17:50 + 15 分钟 = 周一 09:05 当地", () => {
  // 周五 17:50 EDT = 21:50Z → 周一 09:05 EST = 14:05Z
  assert.equal(iso(addSlaMinutes(new Date("2026-10-30T21:50:00Z"), 15, TOR)), "2026-11-02T14:05:00.000Z");
  assert.equal(slaMinutesBetween(new Date("2026-10-30T21:50:00Z"), new Date("2026-11-02T14:05:00Z"), TOR), 15);
  // 周五 17:50 EST = 22:50Z → 周一 09:05 EDT = 13:05Z
  assert.equal(iso(addSlaMinutes(new Date("2027-03-12T22:50:00Z"), 15, TOR)), "2027-03-15T13:05:00.000Z");
  assert.equal(slaMinutesBetween(new Date("2027-03-12T22:50:00Z"), new Date("2027-03-15T13:05:00Z"), TOR), 15);
});

ok("夏令时：悉尼拨快周末（2026-10-04），周五 16:30 AEST + 60 分钟 = 周一 09:30 AEDT", () => {
  // 周五 16:30 AEST(+10) = 06:30Z → 周五 30 分钟 + 周一 30 分钟 → 周一 09:30 AEDT(+11) = 周日 22:30Z
  assert.equal(iso(addSlaMinutes(new Date("2026-10-02T06:30:00Z"), 60, SYD)), "2026-10-04T22:30:00.000Z");
});

ok("当地时刻 → UTC：空档取拨快后的时刻，重叠取较早的一次（UTC 以西 / 以东都成立）", () => {
  assert.equal(iso(zonedLocalToUtc("2027-03-14", 2 * 60 + 30, "America/Toronto")), "2027-03-14T07:30:00.000Z");
  assert.equal(iso(zonedLocalToUtc("2026-11-01", 60 + 30, "America/Toronto")), "2026-11-01T05:30:00.000Z");
  // UTC 以东：柏林 2026-10-25 回拨（03:00 CEST → 02:00 CET），02:30 出现两次 → 取 CEST 那次（00:30Z），不是 CET 的 01:30Z
  assert.equal(iso(zonedLocalToUtc("2026-10-25", 2 * 60 + 30, "Europe/Berlin")), "2026-10-25T00:30:00.000Z");
  // 悉尼 2026-04-05 回拨（03:00 AEDT → 02:00 AEST），02:30 → AEDT 那次（04-04 15:30Z）
  assert.equal(iso(zonedLocalToUtc("2026-04-05", 2 * 60 + 30, "Australia/Sydney")), "2026-04-04T15:30:00.000Z");
  // 柏林 2026-03-29 拨快（02:00 CET → 03:00 CEST）：02:30 不存在 → 拨快后的 03:30 CEST（01:30Z）
  assert.equal(iso(zonedLocalToUtc("2026-03-29", 2 * 60 + 30, "Europe/Berlin")), "2026-03-29T01:30:00.000Z");
  // 非切换日不受影响
  assert.equal(iso(zonedLocalToUtc("2026-10-26", 9 * 60, "Europe/Berlin")), "2026-10-26T08:00:00.000Z");
  assert.equal(iso(zonedLocalToUtc("2026-10-24", 9 * 60, "Europe/Berlin")), "2026-10-24T07:00:00.000Z");
  assert.equal(iso(zonedLocalToUtc("2026-11-02", 9 * 60, "America/Toronto")), "2026-11-02T14:00:00.000Z");
  assert.equal(iso(zonedLocalToUtc("2026-09-07", 9 * 60, "Asia/Shanghai")), "2026-09-07T01:00:00.000Z");
});

console.log("\n[3] 策略合并");

ok("默认：四个新字段全 null，既有默认值不变；未启用分级", () => {
  const sla = DEFAULT_REVENUE_SPINE_POLICY.salesSla;
  assert.equal(sla.newInquiryResponseHours, 4);
  assert.equal(sla.customerReplyResponseHours, 8);
  assert.equal(sla.unclaimedAlertMinutes, null);
  assert.equal(sla.ownerEscalationMinutes, null);
  assert.equal(sla.overdueDraftHours, null);
  assert.equal(sla.businessHours, null);
  assert.equal(slaTiersEnabled(sla), false);
  // 存量策略（没有这些键）合并后仍是 null
  const legacy = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { salesSla: { newInquiryResponseHours: 6 } });
  assert.equal(legacy.salesSla.newInquiryResponseHours, 6);
  assert.equal(legacy.salesSla.unclaimedAlertMinutes, null);
  assert.equal(legacy.salesSla.businessHours, null);
});

ok("合法值进入、显式 null 关闭、非法值保留原值、超上限保留原值", () => {
  const p = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, {
    salesSla: {
      unclaimedAlertMinutes: 15,
      ownerEscalationMinutes: 120.4,
      overdueDraftHours: 24,
      businessHours: { timezone: "Asia/Shanghai", start: "09:00", end: "18:00", workdays: [5, 1, 2, 3, 4, 4] },
    },
  });
  assert.equal(p.salesSla.unclaimedAlertMinutes, 15);
  assert.equal(p.salesSla.ownerEscalationMinutes, 120);
  assert.equal(p.salesSla.overdueDraftHours, 24);
  assert.deepEqual(p.salesSla.businessHours, { timezone: "Asia/Shanghai", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] });
  assert.equal(slaTiersEnabled(p.salesSla), true);

  const bad = mergeRevenueSpinePolicy(p, {
    salesSla: { unclaimedAlertMinutes: -5, ownerEscalationMinutes: "120", overdueDraftHours: 9999, businessHours: { timezone: "Mars/Olympus" } },
  });
  assert.equal(bad.salesSla.unclaimedAlertMinutes, 15);
  assert.equal(bad.salesSla.ownerEscalationMinutes, 120);
  assert.equal(bad.salesSla.overdueDraftHours, 24);
  assert.deepEqual(bad.salesSla.businessHours, p.salesSla.businessHours);

  const off = mergeRevenueSpinePolicy(p, { salesSla: { unclaimedAlertMinutes: null, ownerEscalationMinutes: null, overdueDraftHours: null, businessHours: null } });
  assert.equal(off.salesSla.unclaimedAlertMinutes, null);
  assert.equal(off.salesSla.businessHours, null);
  assert.equal(slaTiersEnabled(off.salesSla), false);
  // 只配一档也算启用
  assert.equal(slaTiersEnabled(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { salesSla: { overdueDraftHours: 0.5 } }).salesSla), true);
});

ok("工作时间校验：缺省 09:00 / 18:00 / 周一至周五；start ≥ end、格式错、空工作日 → 无效", () => {
  assert.deepEqual(parseBusinessCalendar({ timezone: "America/Toronto" }), { timezone: "America/Toronto", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseBusinessCalendar({ timezone: "Asia/Shanghai", start: "08:30", end: "24:00", workdays: [6, 7] }), {
    timezone: "Asia/Shanghai",
    start: "08:30",
    end: "24:00",
    workdays: [6, 7],
  });
  assert.equal(parseBusinessCalendar(null), null);
  assert.equal(parseBusinessCalendar({ timezone: "Asia/Shanghai", start: "18:00", end: "09:00" }), undefined);
  assert.equal(parseBusinessCalendar({ timezone: "Asia/Shanghai", start: "9:00" }), undefined);
  assert.equal(parseBusinessCalendar({ timezone: "Asia/Shanghai", workdays: [0, 8] }), undefined);
  assert.equal(parseBusinessCalendar({ timezone: "" }), undefined);
  assert.equal(parseBusinessCalendar("Asia/Shanghai"), undefined);
});

ok("合并结果（PUT /api/revenue/policy 存的就是它）再合并不丢新字段", () => {
  const p = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, {
    salesSla: { unclaimedAlertMinutes: 15, ownerEscalationMinutes: 120, overdueDraftHours: 24, businessHours: { timezone: "Asia/Shanghai" } },
  });
  const stored = JSON.parse(JSON.stringify({ ...p, businessProfile: undefined }));
  const again = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, stored);
  assert.deepEqual(again.salesSla, p.salesSla);
});

console.log("\n[4] Next action 按组织工作时间");

ok("reply_inquiry / reply_customer 到期按工作时间；未配置 = 旧口径", () => {
  const withCal: RevenueSpinePolicy = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { salesSla: { businessHours: SH } });
  const fri17 = new Date("2026-09-11T09:00:00Z"); // 周五 17:00 上海
  const opp = { stage: "new_inquiry", createdAt: fri17, stageChangedAt: fri17, lastInteractionAt: fri17, lastCustomerReplyAt: fri17, lastOutboundAt: null, followUpCount: 0 };
  const a = computeNextAction(opp, withCal, fri17)!;
  assert.equal(a.type, "reply_inquiry");
  assert.equal(iso(a.at), "2026-09-14T04:00:00.000Z"); // 周一 12:00 上海
  const legacy = computeNextAction(opp, DEFAULT_REVENUE_SPINE_POLICY, fri17)!;
  assert.equal(iso(legacy.at), iso(addBusinessHours(fri17, 4)));
  const out = new Date("2026-09-10T02:00:00Z");
  const c = computeNextAction({ ...opp, stage: "qualified", lastOutboundAt: out }, withCal, fri17)!;
  assert.equal(c.type, "reply_customer");
  assert.equal(iso(c.at), iso(addBusinessHours(fri17, 8, SH)));
  // 跟进类（工作日）不受影响
  const f = computeNextAction({ ...opp, stage: "qualified", lastCustomerReplyAt: out, lastOutboundAt: fri17 }, withCal, fri17)!;
  assert.equal(f.type, "follow_up");
  assert.equal(iso(f.at), iso(addBusinessDays(fri17, 3)));
});

console.log("\n[5] 分级决策");

const TIERS = { unclaimedAlertMinutes: 15, ownerEscalationMinutes: 120, overdueDraftHours: 24, businessHours: null };

ok("档位顺序与分钟数", () => {
  assert.deepEqual(slaTierThresholds(TIERS), [
    { tier: "unclaimed", minutes: 15 },
    { tier: "escalation", minutes: 120 },
    { tier: "overdue_draft", minutes: 1440 },
  ]);
  assert.deepEqual(slaTierThresholds({ ...TIERS, unclaimedAlertMinutes: null, overdueDraftHours: null }), [{ tier: "escalation", minutes: 120 }]);
  assert.deepEqual(slaTierThresholds({ unclaimedAlertMinutes: null, ownerEscalationMinutes: null, overdueDraftHours: null, businessHours: null }), []);
});

ok("自然时间：T+14 不发；T+15 只发第一档；T+2h 两档；T+24h 三档；已回复不发", () => {
  const t = new Date("2026-09-12T10:00:00Z"); // 周六（无日历，周末照样计时）
  const at = (ms: number) => decideSlaTiers({ inboundAt: t, responded: false }, TIERS, new Date(t.getTime() + ms)).map((d) => d.tier);
  assert.deepEqual(at(14 * MIN), []);
  assert.deepEqual(at(15 * MIN), ["unclaimed"]);
  assert.deepEqual(at(2 * HOUR), ["unclaimed", "escalation"]);
  assert.deepEqual(at(24 * HOUR), ["unclaimed", "escalation", "overdue_draft"]);
  assert.deepEqual(decideSlaTiers({ inboundAt: t, responded: true }, TIERS, new Date(t.getTime() + 24 * HOUR)), []);
});

ok("已被人认领（in_progress）：跳过未认领那一档，升级 / 第三档照常", () => {
  const t = new Date("2026-09-07T00:00:00Z");
  const at = (ms: number) => decideSlaTiers({ inboundAt: t, responded: false, claimed: true }, TIERS, new Date(t.getTime() + ms)).map((d) => d.tier);
  assert.deepEqual(at(16 * MIN), []);
  assert.deepEqual(at(2 * HOUR), ["escalation"]);
  assert.deepEqual(at(24 * HOUR), ["escalation", "overdue_draft"]);
});

ok("错过超过 24 小时的档位不补发（刚启用分级时不给积压询盘补提醒）", () => {
  const t = new Date("2026-09-07T00:00:00Z");
  const at = (ms: number) => decideSlaTiers({ inboundAt: t, responded: false }, TIERS, new Date(t.getTime() + ms)).map((d) => d.tier);
  assert.deepEqual(at(15 * MIN + SLA_TIER_MAX_LATE_MS), ["unclaimed", "escalation", "overdue_draft"]);
  assert.deepEqual(at(15 * MIN + SLA_TIER_MAX_LATE_MS + 1), ["escalation", "overdue_draft"]);
  assert.deepEqual(at(10 * 24 * HOUR), []);
});

ok("工作时间：周六进来的询盘，第一档在周一 09:15 当地到期", () => {
  const sla = { ...TIERS, businessHours: SH };
  const sat = new Date("2026-09-12T03:00:00Z");
  const due = (now: string) => decideSlaTiers({ inboundAt: sat, responded: false }, sla, new Date(now)).map((d) => d.tier);
  assert.deepEqual(due("2026-09-13T12:00:00Z"), []);
  assert.deepEqual(due("2026-09-14T01:14:00Z"), []);
  assert.deepEqual(due("2026-09-14T01:15:00Z"), ["unclaimed"]);
  assert.deepEqual(due("2026-09-14T03:00:00Z"), ["unclaimed", "escalation"]);
  const d = decideSlaTiers({ inboundAt: sat, responded: false }, sla, new Date("2026-09-14T01:15:00Z"))[0];
  assert.equal(iso(d.dueAt), "2026-09-14T01:15:00.000Z");
});

ok("工作时间 + 夏令时：多伦多周五 17:50 进来，回拨后的周一 09:05 EST 才到第一档", () => {
  const sla = { ...TIERS, businessHours: TOR };
  const t = new Date("2026-10-30T21:50:00Z");
  assert.deepEqual(decideSlaTiers({ inboundAt: t, responded: false }, sla, new Date("2026-11-02T14:04:00Z")), []);
  assert.deepEqual(
    decideSlaTiers({ inboundAt: t, responded: false }, sla, new Date("2026-11-02T14:05:00Z")).map((d) => d.tier),
    ["unclaimed"],
  );
});

ok("回复判定：询盘之后（容差 60 秒内）任一来源有回复即算已回复", () => {
  const t = new Date("2026-09-07T02:00:00Z");
  assert.equal(hasResponseSince(t, [null, undefined]), false);
  assert.equal(hasResponseSince(t, [new Date(t.getTime() - 2 * MIN)]), false);
  assert.equal(hasResponseSince(t, [new Date(t.getTime() - 30_000)]), true);
  assert.equal(hasResponseSince(t, [null, new Date(t.getTime() + 5 * MIN)]), true);
});

ok("幂等键带版本、档位、组织、行动", () => {
  assert.equal(slaTierSourceKey("escalation", "org_1", "act_9"), "inquiry-sla:v2:escalation:org_1:act_9");
  // 与旧键（inquiry-sla:5m: / inquiry-sla:24h:）不相交
  assert.ok(!slaTierSourceKey("unclaimed", "o", "a").startsWith("inquiry-sla:5m:"));
});

ok("正文：不含买家邮箱 / 电话；第三档说明草稿状态且声明不会自动发信", () => {
  const buyer = { scoreGrade: "HOT", score: 88, market: "Canada", source: "website_inquiry", customerName: "buyer@maple-home.test +1 416 555 0199" };
  const m1 = formatSlaTierMessage({ tier: "unclaimed", minutes: 15, basis: "wall_clock", buyer, link: "https://app.example.test/revenue/opp1" });
  const m2 = formatSlaTierMessage({ tier: "escalation", minutes: 120, basis: "business", buyer, ownerName: "Trade Rep", link: "https://app.example.test/revenue/opp1" });
  const draft = describeDraftState({ pendingDraftCreatedAt: new Date("2026-09-07T00:00:00Z"), fdeStatus: "completed", draftStatus: "created" }, new Date("2026-09-07T03:00:00Z"));
  const m3 = formatSlaTierMessage({ tier: "overdue_draft", minutes: 1440, basis: "wall_clock", buyer, draft, link: "https://app.example.test/revenue/today#approvals" });
  for (const m of [m1, m2, m3]) {
    assert.ok(!/@/.test(m.title + m.text), m.text);
    assert.ok(!/555/.test(m.title + m.text), m.text);
  }
  assert.match(m1.title, /^询盘 15 分钟 未回复/);
  assert.match(m2.title, /2 小时（工作时间）/);
  assert.match(m2.text, /负责人：Trade Rep/);
  assert.match(m3.text, /审批中心等待批准（已等 3 小时）/);
  assert.match(m3.text, /不会自动给买家发邮件/);
  assert.equal(formatThreshold(90), "1 小时 30 分钟");
});

ok("没有草稿的原因：FDE 失败 / 未完成 / 不做类目 / 护栏 / 无邮箱 / 草稿被拒或过期", () => {
  const now = new Date("2026-09-08T00:00:00Z");
  const d = (fdeStatus: string | null, draftStatus: string | null) => describeDraftState({ pendingDraftCreatedAt: null, fdeStatus, draftStatus }, now);
  assert.match(d("failed", null).text, /AI 起草失败/);
  assert.match(d("run_blocked", null).text, /AI 起草失败/);
  assert.match(d("queued", null).text, /还没完成起草/);
  assert.match(d(null, null).text, /还没完成起草/);
  assert.match(d("completed", "out_of_range").text, /不做的类目/);
  assert.match(d("completed", "guardrail_blocked").text, /护栏/);
  assert.match(d("completed", "no_email").text, /没有留邮箱/);
  assert.match(d("completed", "created").text, /拒绝或已过期/);
  assert.equal(d("completed", "out_of_range").hasDraft, false);
});

ok("第一档措辞按实际草稿状态：有草稿才让人去审批中心；没草稿说原因；不知道时用中性说法", () => {
  const buyer = { scoreGrade: "WARM", score: 60, market: "Canada", source: "website_inquiry", customerName: "Maple Home Goods" };
  const now = new Date("2026-09-07T00:20:00Z");
  const link = "https://app.example.test/revenue/opp1";
  const withDraft = describeDraftState({ pendingDraftCreatedAt: new Date("2026-09-07T00:10:00Z"), fdeStatus: "completed", draftStatus: "created" }, now);
  const m1 = formatSlaTierMessage({ tier: "unclaimed", minutes: 15, basis: "wall_clock", buyer, draft: withDraft, link });
  assert.match(m1.text, /审批中心等待批准/);
  assert.match(m1.text, /需人工批准后才会发给买家/);
  for (const [fdeStatus, draftStatus, re] of [
    ["completed", "no_email", /没有留邮箱/],
    ["completed", "out_of_range", /不做的类目/],
    ["completed", "guardrail_blocked", /护栏/],
    ["failed", null, /AI 起草失败/],
    ["queued", null, /还没完成起草/],
  ] as const) {
    const draft = describeDraftState({ pendingDraftCreatedAt: null, fdeStatus, draftStatus }, now);
    const m = formatSlaTierMessage({ tier: "unclaimed", minutes: 15, basis: "wall_clock", buyer, draft, link });
    assert.match(m.text, re, m.text);
    assert.doesNotMatch(m.text, /回复草稿在审批中心/, m.text);
    assert.doesNotMatch(m.text, /审批中心等待批准/, m.text);
  }
  const neutral = formatSlaTierMessage({ tier: "unclaimed", minutes: 15, basis: "wall_clock", buyer, link });
  assert.match(neutral.text, /如有回复草稿/);
});

ok("旧线程提醒的分工：跟踪中 / 这次进线就是分级询盘（已回复、已关闭也算）→ 跳过；询盘之后再来信 → 照常；未启用 → 不跳过", () => {
  const C = new Date("2026-09-07T10:00:00Z"); // 询盘行动创建
  const threads = [
    { prospectId: "p1", lastInboundAt: new Date(C.getTime() - 2_000) }, // 网站询盘：先写外贸消息、再建行动
    { prospectId: "p2", lastInboundAt: new Date(C.getTime() + 3 * HOUR) }, // 询盘之后客户再来信
    { prospectId: "p3", lastInboundAt: new Date(C.getTime() + 3 * HOUR) }, // 再来信，但商机仍被跟踪（还没人回）
    { prospectId: "p4", lastInboundAt: C }, // 没链接商机
    { prospectId: "p5", lastInboundAt: new Date(C.getTime() - 10 * MIN) }, // 行动晚建（入链延迟 / 重放补建）：线程最后进线仍归这次询盘
    { prospectId: "p6", lastInboundAt: C.toISOString() }, // 链接到展会卡 / 测试询盘（不在 inquiryAtByOpp）
  ];
  const oppsByProspect = new Map<string, string[]>([
    ["p1", ["o1"]],
    ["p2", ["o2"]],
    ["p3", ["o3"]],
    ["p5", ["o5"]],
    ["p6", ["o6"]],
  ]);
  const inquiryAtByOpp = new Map<string, Date[]>([
    ["o1", [C]],
    ["o2", [C]],
    ["o3", [C]],
    ["o5", [C]],
  ]);
  // o1 已回复 / 已关闭（不在 tracked），o3 仍在跟踪
  const owned = threadsOwnedByTiers(threads, oppsByProspect, { tracked: new Set(["o3"]), inquiryAtByOpp });
  assert.deepEqual([...owned].sort(), ["p1", "p3", "p5"]);
  // 组织未启用 / 分级本轮失败：不跳过
  assert.deepEqual([...threadsOwnedByTiers(threads, oppsByProspect, undefined)], []);
  // 启用但此刻没有跟踪中的商机：已回复 / 已关闭的那次询盘仍然跳过
  assert.deepEqual([...threadsOwnedByTiers(threads, oppsByProspect, { tracked: new Set(), inquiryAtByOpp })].sort(), ["p1", "p5"]);
  // 容差边界：进线晚于行动 60 秒以内仍算这次询盘，超过即是再来信
  const edge = (ms: number) => threadsOwnedByTiers([{ prospectId: "p1", lastInboundAt: new Date(C.getTime() + ms) }], oppsByProspect, { tracked: new Set(), inquiryAtByOpp });
  assert.equal(edge(60_000).size, 1);
  assert.equal(edge(60_001).size, 0);
});

ok("首封护栏标记：护栏拦截写；买家没邮箱但草稿也触发护栏也写（计数不漏）；其它情况不写", () => {
  const now = new Date("2026-09-07T01:00:00Z");
  assert.deepEqual(guardrailMarkerPatch("guardrail_blocked", ["price"], now), { guardrailBlockedAt: now.toISOString(), guardrailViolations: ["price"] });
  assert.deepEqual(guardrailMarkerPatch("no_email", ["moq"], now), { guardrailBlockedAt: now.toISOString(), guardrailViolations: ["moq"] });
  assert.deepEqual(guardrailMarkerPatch("no_email", [], now), {});
  assert.deepEqual(guardrailMarkerPatch("created", ["price"], now), {});
  assert.deepEqual(guardrailMarkerPatch("out_of_range", null, now), {});
  assert.equal(guardrailMarkerPatch("guardrail_blocked", Array.from({ length: 30 }, (_, i) => `v${i}`), now).guardrailViolations?.length, 20);
});

console.log(`\nsla-tiers: ${pass} passed`);
