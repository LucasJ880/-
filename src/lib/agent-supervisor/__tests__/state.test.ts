/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/state.test.ts
 */
import {
  ComplexityResultSchema,
  PlannerOutputSchema,
  ObserverOutputSchema,
  SupervisorStepSchema,
} from "../types";

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

expect(
  ComplexityResultSchema.safeParse({
    mode: "supervisor",
    reason: "multi",
    confidence: 0.9,
    candidateSkills: ["sales-pipeline-forecast"],
  }).success,
  "Complexity schema",
);

expect(
  PlannerOutputSchema.safeParse({
    objective: "分析销售",
    steps: [
      {
        id: "step-1",
        order: 1,
        worker: "sales",
        skillSlug: "sales-pipeline-forecast",
        objective: "管道",
      },
    ],
  }).success,
  "Planner schema",
);

expect(
  ObserverOutputSchema.safeParse({
    decision: "continue",
    reason: "ok",
  }).success,
  "Observer schema",
);

expect(
  SupervisorStepSchema.safeParse({
    id: "step-1",
    order: 1,
    worker: "tender",
    skillSlug: "tender-bid-no-bid",
    objective: "去留",
  }).success,
  "Step schema",
);

expect(
  !PlannerOutputSchema.safeParse({
    objective: "x",
    steps: Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      order: i + 1,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "o",
    })),
  }).success,
  "Planner 拒绝超过 5 步",
);

console.log(`\n${failed === 0 ? "✅" : "❌"} state: ${total - failed}/${total}`);
if (failed) process.exit(1);
