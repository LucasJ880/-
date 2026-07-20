/**
 * 运行：npx tsx src/lib/employee-ai/__tests__/practice-and-playbook.test.ts
 */
import { detectNoDiscountFirstTouchPattern } from "../practice-miner";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const events = [
  ...Array.from({ length: 3 }).map((_, i) => ({
    id: `f${i}`,
    userId: "u1",
    feedbackScope: "team_candidate",
    humanDecision: "edited",
    taskType: "quote_followup_email",
    diffSummary: { notes: ["删除折扣相关表述"] },
  })),
  ...Array.from({ length: 3 }).map((_, i) => ({
    id: `g${i}`,
    userId: "u2",
    feedbackScope: "team_candidate",
    humanDecision: "edited",
    taskType: "quote_followup_email",
    diffSummary: { notes: ["删除折扣相关表述"] },
  })),
];

const outcomes = events.slice(0, 2).map((e) => ({
  id: `o-${e.id}`,
  feedbackEventId: e.id,
  sourceType: "user_confirmed",
  manuallyVerified: true,
  confidence: 0.9,
}));

const pattern = detectNoDiscountFirstTouchPattern(events, outcomes);
expect(!!pattern, "多员工+Outcome 可形成候选");
expect(pattern!.uniqueUsers >= 2, "至少两名员工");

const personalOnly = detectNoDiscountFirstTouchPattern(
  events.map((e) => ({ ...e, feedbackScope: "personal_only" })),
  outcomes,
);
expect(!personalOnly, "personal_only 不能进入部门候选");

const doNot = detectNoDiscountFirstTouchPattern(
  events.map((e) => ({ ...e, feedbackScope: "do_not_learn" })),
  outcomes,
);
expect(!doNot, "do_not_learn 不能被挖掘");

console.log(`\n${total - failed}/${total} passed`);
if (failed) process.exit(1);
