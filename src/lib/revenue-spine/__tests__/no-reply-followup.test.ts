/**
 * 买家没回信时的跟进草稿：到期判断 / 正文 纯函数测试
 * 运行：npx tsx src/lib/revenue-spine/__tests__/no-reply-followup.test.ts
 */

import assert from "node:assert/strict";
import { buildNoReplyFollowUpDraft, noReplyFollowUpDue, type NoReplyFollowUpInput } from "../fde/no-reply-followup";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy } from "../policy";
import { buildClarifyingQuestions } from "../rfq/missing-info";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const DAYS = [3, 7, 14];
const SENT = new Date("2026-11-01T02:00:00Z");
const at = (d: number, h = 0) => new Date(SENT.getTime() + d * 86_400_000 + h * 3_600_000);
const opp = (over: Partial<{ stage: string; lastOutboundAt: Date | null; lastCustomerReplyAt: Date | null; followUpCount: number }> = {}) => ({
  stage: "needs_info",
  lastOutboundAt: SENT,
  lastCustomerReplyAt: null,
  followUpCount: 1,
  ...over,
});

function input(over: Partial<NoReplyFollowUpInput> = {}): NoReplyFollowUpInput {
  return {
    step: 1,
    total: 3,
    language: "en",
    contactName: "Emma Brown",
    orgName: "Mengxin Home Textile",
    senderName: "Cathy",
    previousSubject: "Great meeting you at the 140th Canton Fair (Booth 14.3E07) — Flannel / Coral Fleece Blanket and 1 more — Mengxin Home Textile",
    previousSentAt: SENT,
    product: "Flannel / Coral Fleece Blanket and 1 more",
    event: "the 140th Canton Fair (Booth 14.3E07)",
    questions: buildClarifyingQuestions(["quantity", "size", "destinationCountry", "destinationCity"], "en", 3),
    ...over,
  };
}

console.log("no-reply-followup");

ok("到期：首封后第 3 天第 1 次、第 7 天第 2 次、第 14 天第 3 次；之后不再起草", () => {
  assert.equal(noReplyFollowUpDue(opp(), DAYS, at(2, 23)), null);
  assert.deepEqual(noReplyFollowUpDue(opp(), DAYS, at(3)), { step: 1, total: 3, day: 3, dueAt: at(3) });
  // 第 1 次跟进在第 4 天才发出：第 2 次在其后 4 天（首封后 7 天的节奏），不会挤在一起
  const sent2 = at(4);
  assert.equal(noReplyFollowUpDue(opp({ lastOutboundAt: sent2, followUpCount: 2 }), DAYS, at(7, 23)), null);
  assert.equal(noReplyFollowUpDue(opp({ lastOutboundAt: sent2, followUpCount: 2 }), DAYS, at(8))?.step, 2);
  assert.equal(noReplyFollowUpDue(opp({ lastOutboundAt: at(8), followUpCount: 3 }), DAYS, at(15))?.day, 14);
  assert.equal(noReplyFollowUpDue(opp({ lastOutboundAt: at(15), followUpCount: 4 }), DAYS, at(60)), null);
  // 错过超过 7 天不再补（上线时几周前的老询盘不会一口气冒出草稿）
  assert.equal(noReplyFollowUpDue(opp(), DAYS, at(10))?.step, 1);
  assert.equal(noReplyFollowUpDue(opp(), DAYS, at(10, 1)), null);
});

ok("不起草：买家回信了、还没发过首封、进入报价及之后的阶段、关闭了跟进", () => {
  assert.equal(noReplyFollowUpDue(opp({ lastCustomerReplyAt: at(1) }), DAYS, at(5)), null);
  assert.equal(noReplyFollowUpDue(opp({ lastOutboundAt: null, followUpCount: 0 }), DAYS, at(5)), null);
  for (const stage of ["quoting", "quoted", "sample", "negotiation", "won", "lost", "nurture", "stale"]) {
    assert.equal(noReplyFollowUpDue(opp({ stage }), DAYS, at(5)), null, stage);
  }
  assert.equal(noReplyFollowUpDue(opp(), [], at(5)), null);
  // 买家来信早于我方外发（已回复过）不影响
  assert.equal(noReplyFollowUpDue(opp({ lastCustomerReplyAt: new Date(SENT.getTime() - 3_600_000) }), DAYS, at(3))?.step, 1);
});

ok("策略：默认 3/7/14；可改节奏；显式 [] 关闭", () => {
  assert.deepEqual(DEFAULT_REVENUE_SPINE_POLICY.followUp.noReplyFollowUpDays, [3, 7, 14]);
  assert.deepEqual(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { followUp: { noReplyFollowUpDays: [14, 2, 7, 7] } }).followUp.noReplyFollowUpDays, [2, 7, 14]);
  assert.deepEqual(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { followUp: { noReplyFollowUpDays: [] } }).followUp.noReplyFollowUpDays, []);
  assert.deepEqual(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { followUp: {} }).followUp.noReplyFollowUpDays, [3, 7, 14]);
});

ok("第 1 次（展会）：沿用上一封主题，提展会回程，列出缺的信息，不写任何承诺", () => {
  const d = buildNoReplyFollowUpDraft(input());
  assert.equal(d.subject, "Re: Great meeting you at the 140th Canton Fair (Booth 14.3E07) — Flannel / Coral Fleece Blanket and 1 more — Mengxin Home Textile");
  assert.match(d.body, /^Dear Emma Brown,\n\nI hope you had a good trip back from the 140th Canton Fair \(Booth 14\.3E07\)\./);
  assert.match(d.body, /my email of November 1 about Flannel \/ Coral Fleece Blanket and 1 more/);
  assert.match(d.body, /\n1\. What quantity are you planning to order\?\n2\. /);
  assert.equal(d.body.split("\n").filter((l) => /^\d+\.\s/.test(l)).length, 3);
  assert.match(d.body, /Best regards,\nCathy\nMengxin Home Textile$/);
  assert.deepEqual(d.guardrailViolations, []);
});

ok("第 1 次（网站询盘）：感谢询盘；没有缺项时问数量和交期；主题已是 Re: 不重复加", () => {
  const d = buildNoReplyFollowUpDraft(input({ event: null, product: "bathrobes", previousSubject: "Re: Your inquiry about bathrobes (2000 pcs) — Mengxin Home Textile", questions: [] }));
  assert.equal(d.subject, "Re: Your inquiry about bathrobes (2000 pcs) — Mengxin Home Textile");
  assert.match(d.body, /Thank you again for your inquiry about bathrobes\./);
  assert.match(d.body, /1\. What quantity are you planning to order, and when would you like the goods delivered\?/);
});

ok("第 2 次：问项目是否还在进行，展会买家提参考款可按规格定做；第 3 次：说明是最后一次", () => {
  const d2 = buildNoReplyFollowUpDraft(input({ step: 2 }));
  assert.match(d2.body, /still active/);
  assert.match(d2.body, /reference styles you saw at our booth, and each of them can be made to your own specification/);
  assert.match(d2.body, /As soon as we know your quantity, size, destination country, we will prepare a quotation for you\./);
  const d3 = buildNoReplyFollowUpDraft(input({ step: 3 }));
  assert.match(d3.body, /this will be my last follow-up for now/);
  assert.doesNotMatch(d3.body, /\n1\. /);
  for (const d of [d2, d3]) assert.deepEqual(d.guardrailViolations, []);
});

ok("中文：同样三段；没有上一封主题时自拟主题", () => {
  const zq = buildClarifyingQuestions(["quantity", "size"], "zh", 3);
  const d1 = buildNoReplyFollowUpDraft(input({ language: "zh", contactName: "王先生", previousSubject: null, product: "珊瑚绒毯", event: "第 140 届广交会", questions: zq }));
  assert.equal(d1.subject, "跟进：珊瑚绒毯 — Mengxin Home Textile");
  assert.match(d1.body, /^王先生，您好：\n\n希望您从第 140 届广交会回去一路顺利。/);
  assert.match(d1.body, /11 月 1 日 发给您的邮件（珊瑚绒毯）/);
  assert.match(d1.body, /\n1\. 请告知本次预计采购数量。/);
  assert.match(buildNoReplyFollowUpDraft(input({ language: "zh", step: 3, product: "珊瑚绒毯", questions: zq })).body, /这是我近期最后一次跟进/);
  assert.match(buildNoReplyFollowUpDraft(input({ language: "zh", previousSubject: "感谢展位来访：珊瑚绒毯 — 梦馨家纺" })).subject, /^回复：感谢展位来访/);
});

console.log(`\n${pass} passed`);
