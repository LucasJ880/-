/**
 * Revenue Spine — 阶段状态机纯函数测试
 * 运行：npx tsx src/lib/revenue-spine/__tests__/opportunity-stage.test.ts
 */
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  OPPORTUNITY_STAGES,
  OpportunityStage,
  OpportunityTransitionError,
  assertTransition,
  canTransition,
  isOpenStage,
  isTerminalStage,
  toCanonicalStage,
} from "../opportunity-stage";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}
console.log("revenue-spine/opportunity-stage");

ok("15 个 canonical 阶段且每个都有流转表", () => {
  assert.equal(OPPORTUNITY_STAGES.length, 15);
  for (const s of OPPORTUNITY_STAGES) assert.ok(Array.isArray(ALLOWED_TRANSITIONS[s]), s);
});

ok("主链 NEW_INQUIRY→…→WON 每一步都允许", () => {
  const chain = ["new_inquiry", "enriching", "qualified", "rfq_ready", "quoting", "quoted", "follow_up", "sample", "negotiation", "won"] as const;
  for (let i = 0; i < chain.length - 1; i++) assert.ok(canTransition(chain[i], chain[i + 1]), `${chain[i]}→${chain[i + 1]}`);
});

ok("ENRICHING 可分流到 NEEDS_INFO / QUALIFIED / DISQUALIFIED", () => {
  assert.ok(canTransition("enriching", "needs_info"));
  assert.ok(canTransition("enriching", "qualified"));
  assert.ok(canTransition("enriching", "disqualified"));
});

ok("QUOTED → FOLLOW_UP / SAMPLE / NEGOTIATION / LOST 允许", () => {
  for (const to of ["follow_up", "sample", "negotiation", "lost"] as const) assert.ok(canTransition("quoted", to), to);
});

ok("非法流转被拒：NEW_INQUIRY→WON、QUOTED→NEW_INQUIRY、WON→任何", () => {
  assert.equal(canTransition("new_inquiry", "won"), false);
  assert.equal(canTransition("quoted", "new_inquiry"), false);
  for (const s of OPPORTUNITY_STAGES) assert.equal(canTransition("won", s), false, `won→${s}`);
  assert.throws(() => assertTransition("new_inquiry", "won"), OpportunityTransitionError);
});

ok("同阶段不是流转", () => {
  assert.equal(canTransition("quoted", "quoted"), false);
});

ok("LOST 可复活到 NURTURE；NURTURE 可回到 QUALIFIED/FOLLOW_UP", () => {
  assert.ok(canTransition("lost", "nurture"));
  assert.ok(canTransition("nurture", "qualified"));
  assert.ok(canTransition("nurture", "follow_up"));
});

ok("终态 / 开放态判定", () => {
  assert.ok(isTerminalStage("won") && isTerminalStage("lost") && isTerminalStage("disqualified"));
  assert.equal(isTerminalStage("nurture"), false);
  assert.ok(isOpenStage("negotiation"));
  assert.equal(isOpenStage("stale"), false);
});

ok("Sunny 历史阶段投影到 canonical；未知 → null", () => {
  assert.equal(toCanonicalStage("new_lead"), "new_inquiry");
  assert.equal(toCanonicalStage("signed"), "won");
  assert.equal(toCanonicalStage("completed"), "won");
  assert.equal(toCanonicalStage("on_hold"), "nurture");
  assert.equal(toCanonicalStage("QUOTED"), "quoted");
  assert.equal(toCanonicalStage("whatever"), null);
  assert.equal(OpportunityStage.WON, "won");
});

console.log(`\n${pass} passed`);
