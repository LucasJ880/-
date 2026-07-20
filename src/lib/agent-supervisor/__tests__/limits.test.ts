/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/limits.test.ts
 */
import { getSupervisorLimits } from "../config";
import { validateSupervisorPlan } from "../plan-validator";
import type { SupervisorStep } from "../types";

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

const limits = getSupervisorLimits();
expect(limits.maxSteps === 5, "默认 maxSteps=5");
expect(limits.maxReplans === 2, "默认 maxReplans=2");
expect(limits.maxSkillCalls === 6, "默认 maxSkillCalls=6");

const steps: SupervisorStep[] = Array.from({ length: 6 }, (_, i) => ({
  id: `step-${i + 1}`,
  order: i + 1,
  worker: "sales" as const,
  skillSlug: "sales-next-best-action",
  objective: `o${i}`,
  input: {},
  dependsOn: [],
  status: "pending" as const,
  mayCreatePendingAction: false,
}));

const v = validateSupervisorPlan({
  steps,
  maxSteps: 5,
  orgActiveSkillSlugs: new Set(["sales-next-best-action"]),
});
expect(v.steps.length <= 5, "校验强制截断到 5");

console.log(`\n${failed === 0 ? "✅" : "❌"} limits: ${total - failed}/${total}`);
if (failed) process.exit(1);
