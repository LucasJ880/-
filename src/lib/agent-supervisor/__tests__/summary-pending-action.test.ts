/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/summary-pending-action.test.ts
 */
import { formatSummaryForUser, buildFinalSummary } from "../summarize";
import type { SupervisorState } from "../types";
import { getSupervisorLimits } from "../config";

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
const state: SupervisorState = {
  sessionId: "s",
  runId: "r",
  orgId: "o",
  userId: "u",
  originalRequest: "x",
  objective: "准备行动",
  resolvedContext: {},
  mode: "supervisor",
  plan: [
    {
      id: "1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "行动",
      input: {},
      dependsOn: [],
      status: "waiting_for_approval",
      mayCreatePendingAction: true,
    },
  ],
  currentStepIndex: 0,
  observations: [],
  artifacts: [],
  pendingActionIds: ["pa_pending_1"],
  status: "waiting_for_approval",
  stepCount: 1,
  replanCount: 0,
  skillCallCount: 1,
  maxSteps: limits.maxSteps,
  maxReplans: limits.maxReplans,
  maxSkillCalls: limits.maxSkillCalls,
  userVisibleTimeline: [],
  executedFingerprints: [],
};

const text = formatSummaryForUser({
  ...state,
  finalSummary: buildFinalSummary(state),
});
expect(text.includes("待审批"), "摘要含待审批区");
expect(!/已发送|已完成发送/.test(text), "pending 不描述为已发送");
expect(text.includes("pa_pending_1") || text.includes("审批"), "提及待审批");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} summary-pending-action: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
