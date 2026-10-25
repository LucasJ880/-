/**
 * 老板询盘早报 / 新草稿微信提醒：正文格式、绝不出现买家邮箱或电话、去重键、外贸模块门槛、
 * 策略开关 notify.wechatOnNewDraft 的合并（默认关闭，不影响其它默认值）。纯函数，无 DB。
 * 运行：npx tsx src/lib/revenue-spine/__tests__/owner-brief.test.ts
 *
 * 公开仓库：只用虚构企业与号码。
 */
import assert from "node:assert/strict";
import {
  buyerLine,
  formatNewDraftPush,
  formatOwnerBrief,
  newDraftPushSourceKey,
  orgHasTradeModule,
  ownerBriefIsEmpty,
  safeBuyerName,
  stripContactDetails,
} from "../owner-brief";
import type { OwnerApprovalItem, OwnerToday, OwnerTodayCard } from "../owner-today";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy } from "../policy";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ORIGIN = "https://app.example.test";
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;

function card(over: Partial<OwnerTodayCard> = {}): OwnerTodayCard {
  return {
    opportunityId: "o1",
    customerName: "Maple Home Goods",
    title: "Bath towels — Maple Home Goods",
    stage: "new_inquiry",
    score: 82,
    scoreGrade: "HOT",
    priority: "hot",
    market: "Canada",
    source: "website_inquiry",
    sourceLabel: "官网",
    createdAt: new Date("2026-10-24T01:00:00Z"),
    ageMinutes: 60,
    nextActionType: "reply_inquiry",
    nextFollowupAt: null,
    assignedToId: "u1",
    ...over,
  };
}

function approval(id: string, c: OwnerTodayCard | null): OwnerApprovalItem {
  return {
    pendingActionId: id,
    title: `发送询盘回复：${c?.customerName ?? "?"}`,
    // 预览里有买家邮箱与电话（来信原文）——早报绝不能带出来
    preview: "Dear Emma,\nReach me at emma@maple-home.test or +1 416 555 0199.\n——— 中文对照 ———",
    createdAt: new Date("2026-10-24T01:00:00Z"),
    expiresAt: new Date("2026-10-27T01:00:00Z"),
    waitingMinutes: 60,
    opportunity: c,
  };
}

function today(over: Partial<OwnerToday> = {}): OwnerToday {
  const approvals = [
    approval("pa1", card()),
    approval("pa2", card({ opportunityId: "o2", customerName: "buyer@harbor-linen.test", score: 74, scoreGrade: "HIGH", market: "Australia", source: "trade_show", sourceLabel: "展会" })),
    approval("pa3", card({ opportunityId: "o3", customerName: "Fjord Living +47 912 34 567", score: 55, scoreGrade: "MEDIUM", market: "Norway", source: "email", sourceLabel: "邮件" })),
    approval("pa4", card({ opportunityId: "o4", customerName: "Example Textiles", score: 40, scoreGrade: "LOW" })),
  ];
  return {
    generatedAt: new Date("2026-10-24T02:00:00Z"),
    day: "2026-10-24",
    timeZone: "Asia/Shanghai",
    dayStart: new Date("2026-10-23T16:00:00Z"),
    dayEnd: new Date("2026-10-24T16:00:00Z"),
    newToday: [card()],
    overdue: [{ ...card(), overdueMinutes: 150, slaHours: 4 }],
    approvals,
    samplesQuotesDue: [],
    counts: { newToday: 3, overdue: 1, approvals: approvals.length, samplesQuotesDue: 2 },
    ...over,
  };
}

console.log("owner-brief");

ok("早报：四栏计数、按评分前 3 封待审批（HOT 82 · Canada · 官网 · 公司）、其余条数、今日询盘页深链", () => {
  const { title, text } = formatOwnerBrief(today(), { origin: `${ORIGIN}/` });
  assert.equal(title, "今日询盘 10/24：新 3 · 超时 1 · 待审批 4 · 样品/报价 2");
  assert.match(text, /^【今日询盘】10\/24\n今日新询盘 3 · 回复超时 1 · 待审批 4 · 样品\/报价到期 2/);
  assert.match(text, /\n1\. HOT 82 · Canada · 官网 · Maple Home Goods\n/);
  assert.match(text, /\n2\. HIGH 74 · Australia · 展会 · 未留公司名\n/);
  assert.match(text, /\n3\. MEDIUM 55 · Norway · 邮件 · Fjord Living\n/);
  assert.ok(!text.includes("Example Textiles"), "只列前 3 封");
  assert.match(text, /…另 1 封/);
  assert.match(text, /最久已超 2 小时/);
  assert.ok(text.endsWith(`${ORIGIN}/revenue/today`), text);
});

ok("早报绝不出现买家邮箱或电话（公司名里夹带的也去掉；草稿预览不进早报）", () => {
  const { title, text } = formatOwnerBrief(today(), { origin: ORIGIN });
  for (const s of [title, text]) {
    assert.ok(!EMAIL.test(s), `含邮箱：${s}`);
    assert.ok(!PHONE.test(s), `含电话：${s}`);
    assert.ok(!s.includes("Dear Emma"), "不带草稿预览");
  }
});

ok("买家称呼清洗：邮箱 / 电话（≥7 位数字）去掉，普通数字保留；什么都不剩 → 未留公司名", () => {
  assert.equal(safeBuyerName("buyer@harbor-linen.test"), "未留公司名");
  assert.equal(safeBuyerName("+1 (416) 555-0199"), "未留公司名");
  assert.equal(safeBuyerName("Studio 54 Home Ltd"), "Studio 54 Home Ltd");
  assert.equal(safeBuyerName("Maple Home Goods · sales@maple-home.test"), "Maple Home Goods");
  assert.equal(stripContactDetails("  "), null);
  assert.equal(safeBuyerName(null), "未留公司名");
  assert.equal(safeBuyerName("A".repeat(60)).length, 40);
  assert.equal(buyerLine({ scoreGrade: null, score: null, market: null, source: null, customerName: "Example Textiles" }), "未评分 · 国家未知 · 来源未知 · Example Textiles");
});

ok("四栏全为 0 视为空（不发早报）；有任一栏不为 0 就发", () => {
  assert.equal(ownerBriefIsEmpty({ newToday: 0, overdue: 0, approvals: 0, samplesQuotesDue: 0 }), true);
  assert.equal(ownerBriefIsEmpty({ newToday: 0, overdue: 0, approvals: 0, samplesQuotesDue: 1 }), false);
});

ok("没有待审批时不列名单，只给计数与链接", () => {
  const { text } = formatOwnerBrief(today({ approvals: [], overdue: [], counts: { newToday: 2, overdue: 0, approvals: 0, samplesQuotesDue: 0 } }), { origin: ORIGIN });
  assert.ok(!/待审批（/.test(text));
  assert.ok(!/回复超时 \d+ 条/.test(text));
  assert.ok(text.includes(`${ORIGIN}/revenue/today`));
});

ok("新草稿提醒：一行买家概要 + 链接，不含邮箱 / 电话；去重键按审批人 + UTC 小时", () => {
  const { title, text } = formatNewDraftPush({ scoreGrade: "HOT", score: 91, market: "Canada", source: "website_inquiry", customerName: "orders@maple-home.test" }, { origin: ORIGIN });
  assert.equal(title, "新询盘回复草稿待审批");
  assert.match(text, /^HOT 91 · Canada · 官网 · 未留公司名\n/);
  assert.ok(text.includes(`${ORIGIN}/revenue/today`));
  assert.ok(!EMAIL.test(text) && !PHONE.test(text));
  const k1 = newDraftPushSourceKey("org1", "u1", new Date("2026-10-24T02:05:00Z"));
  const k2 = newDraftPushSourceKey("org1", "u1", new Date("2026-10-24T02:59:59Z"));
  const k3 = newDraftPushSourceKey("org1", "u1", new Date("2026-10-24T03:00:00Z"));
  const k4 = newDraftPushSourceKey("org1", "u2", new Date("2026-10-24T02:05:00Z"));
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(k1, k4);
  assert.ok(k1.includes("org1") && k1.includes("u1"));
});

ok("早报只发给显式启用外贸模块的组织", () => {
  assert.equal(orgHasTradeModule({ enabled: ["trade", "sales"] }), true);
  assert.equal(orgHasTradeModule({ enabled: ["sales", "bids", "window_covering"] }), false);
  assert.equal(orgHasTradeModule(null), false);
  assert.equal(orgHasTradeModule({}), false);
});

ok("策略开关 notify.wechatOnNewDraft：默认关闭；只认布尔值；其它默认值不变；与其它字段合并不丢", () => {
  assert.equal(DEFAULT_REVENUE_SPINE_POLICY.notify.wechatOnNewDraft, false);
  const on = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { notify: { wechatOnNewDraft: true } });
  assert.equal(on.notify.wechatOnNewDraft, true);
  const { notify: _a, ...restDefault } = DEFAULT_REVENUE_SPINE_POLICY;
  const { notify: _b, ...restOn } = on;
  void _a;
  void _b;
  assert.deepEqual(restOn, restDefault, "打开提醒不改其它默认值");
  assert.equal(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { notify: { wechatOnNewDraft: "yes" } }).notify.wechatOnNewDraft, false);
  assert.equal(mergeRevenueSpinePolicy(on, { followUp: { staleAfterDays: 30 } }).notify.wechatOnNewDraft, true, "改别的字段不关掉提醒");
  assert.equal(mergeRevenueSpinePolicy(on, { notify: { wechatOnNewDraft: false } }).notify.wechatOnNewDraft, false);
  // 存量策略（没有 notify 字段）读出来仍是关闭
  const legacy = { ...DEFAULT_REVENUE_SPINE_POLICY } as Partial<typeof DEFAULT_REVENUE_SPINE_POLICY>;
  delete legacy.notify;
  assert.equal(mergeRevenueSpinePolicy(legacy as typeof DEFAULT_REVENUE_SPINE_POLICY, { followUp: {} }).notify.wechatOnNewDraft, false);
});

console.log(`  ${pass} passed`);
