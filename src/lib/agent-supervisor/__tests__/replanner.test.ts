/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/replanner.test.ts
 */
import { replanSupervisor } from "../replanner";
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

async function main() {
  const limits = getSupervisorLimits();
  const state: SupervisorState = {
    sessionId: "s",
    runId: "r",
    orgId: "o",
    userId: "u",
    originalRequest: "分析销售并安排工作",
    objective: "分析销售并安排工作",
    resolvedContext: { availableSkills: [] },
    mode: "supervisor",
    plan: [
      {
        id: "step-1",
        order: 1,
        worker: "sales",
        skillSlug: "sales-pipeline-forecast",
        objective: "管道",
        input: {},
        dependsOn: [],
        status: "completed",
        mayCreatePendingAction: false,
      },
    ],
    currentStepIndex: 0,
    observations: [],
    artifacts: [],
    pendingActionIds: [],
    status: "running",
    stepCount: 1,
    replanCount: 0,
    skillCallCount: 1,
    maxSteps: limits.maxSteps,
    maxReplans: limits.maxReplans,
    maxSkillCalls: limits.maxSkillCalls,
    userVisibleTimeline: [],
    executedFingerprints: ["fp"],
  };

  const next = await replanSupervisor(state, "需要补充下一动作");
  expect(next.replanCount === 1, "replanCount +1");
  expect(
    next.plan.some((s) => s.status === "completed"),
    "保留已完成步骤",
  );
  expect(next.plan.length <= limits.maxSteps, "不超过 maxSteps");

  const withReject = await replanSupervisor(
    {
      ...state,
      plan: [
        ...state.plan,
        {
          id: "step-2",
          order: 2,
          worker: "sales",
          skillSlug: "sales-next-best-action",
          objective: "动作",
          input: {},
          dependsOn: ["step-1"],
          status: "failed",
          mayCreatePendingAction: true,
          error: "pending_action_rejected",
          resultSummary: "审批已拒绝",
        },
      ],
    },
    "审批被拒绝",
  );
  expect(
    withReject.plan.some((s) => s.error === "pending_action_rejected"),
    "重规划保留审批拒绝步骤",
  );

  const exhausted = await replanSupervisor(
    { ...next, replanCount: limits.maxReplans },
    "再次失败",
  );
  expect(exhausted.status === "failed", "超过 maxReplans 停止");

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} replanner: ${total - failed}/${total}`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
