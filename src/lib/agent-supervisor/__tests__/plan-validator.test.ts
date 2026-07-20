/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/plan-validator.test.ts
 */
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

const orgSkills = new Set([
  "sales-pipeline-forecast",
  "sales-next-best-action",
  "tender-bid-no-bid",
]);

const good: SupervisorStep[] = [
  {
    id: "step-1",
    order: 1,
    worker: "sales",
    skillSlug: "sales-pipeline-forecast",
    objective: "分析管道",
    input: {},
    dependsOn: [],
    status: "pending",
    mayCreatePendingAction: false,
  },
  {
    id: "step-2",
    order: 2,
    worker: "sales",
    skillSlug: "sales-next-best-action",
    objective: "下一动作",
    input: {},
    dependsOn: ["step-1"],
    status: "pending",
    mayCreatePendingAction: true,
  },
];

expect(
  validateSupervisorPlan({
    steps: good,
    maxSteps: 5,
    orgActiveSkillSlugs: orgSkills,
  }).ok,
  "合法计划通过",
);

const tooMany = Array.from({ length: 8 }, (_, i) => ({
  ...good[0],
  id: `step-${i + 1}`,
  order: i + 1,
  dependsOn: [] as string[],
}));
const trimmed = validateSupervisorPlan({
  steps: tooMany,
  maxSteps: 5,
  orgActiveSkillSlugs: orgSkills,
});
expect(trimmed.steps.length === 5, "超过 5 步被截断");

const badWorker = validateSupervisorPlan({
  steps: [
    {
      ...good[0],
      skillSlug: "tender-bid-no-bid",
    },
  ],
  maxSteps: 5,
  orgActiveSkillSlugs: orgSkills,
});
expect(!badWorker.ok, "Worker 白名单外技能拒绝");

const cycle = validateSupervisorPlan({
  steps: [
    { ...good[0], dependsOn: ["step-2"] },
    { ...good[1], dependsOn: ["step-1"] },
  ],
  maxSteps: 5,
  orgActiveSkillSlugs: orgSkills,
});
expect(!cycle.ok, "依赖环拒绝");

const toolLike = validateSupervisorPlan({
  steps: [
    {
      ...good[0],
      skillSlug: "sales.send_quote_email",
    },
  ],
  maxSteps: 5,
  orgActiveSkillSlugs: new Set(["sales.send_quote_email"]),
});
expect(!toolLike.ok, "直接工具调用拒绝");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} plan-validator: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
