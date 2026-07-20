/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/summary-rejected-action.test.ts
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
      objective: "准备内部备注",
      input: {},
      dependsOn: [],
      status: "failed",
      mayCreatePendingAction: true,
      error: "pending_action_rejected",
      resultSummary: "审批已拒绝，不视为已执行",
    },
  ],
  currentStepIndex: 0,
  observations: [
    {
      stepId: "approval-rejected",
      at: new Date().toISOString(),
      success: false,
      summary: "PendingAction 已拒绝",
      factsLearned: ["审批拒绝，动作未执行"],
      pendingActionIds: [],
      decision: "complete",
    },
  ],
  artifacts: [],
  pendingActionIds: [],
  status: "completed",
  stepCount: 1,
  replanCount: 0,
  skillCallCount: 1,
  maxSteps: limits.maxSteps,
  maxReplans: limits.maxReplans,
  maxSkillCalls: limits.maxSkillCalls,
  userVisibleTimeline: ["有 1 项审批被拒绝，不会当作已执行"],
  executedFingerprints: [],
};

const text = formatSummaryForUser({
  ...state,
  finalSummary: buildFinalSummary(state),
});
expect(/已拒绝/.test(text) && /未执行/.test(text), "明确已拒绝未执行");
expect(!/已发送/.test(text), "拒绝后不出现已发送");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} summary-rejected-action: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
