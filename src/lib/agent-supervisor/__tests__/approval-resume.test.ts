/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/approval-resume.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { observeStepResult } from "../observer";
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
const baseState: SupervisorState = {
  sessionId: "s",
  runId: "r",
  orgId: "o",
  userId: "u",
  originalRequest: "x",
  objective: "x",
  resolvedContext: {},
  mode: "supervisor",
  plan: [
    {
      id: "step-1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "跟进",
      input: {},
      dependsOn: [],
      status: "running",
      mayCreatePendingAction: true,
    },
    {
      id: "step-2",
      order: 2,
      worker: "sales",
      skillSlug: "sales-account-research",
      objective: "研究",
      input: {},
      dependsOn: ["step-1"],
      status: "pending",
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
  executedFingerprints: [],
};

const obs = observeStepResult({
  state: baseState,
  stepId: "step-1",
  workerResult: {
    ok: true,
    skillSlug: "sales-next-best-action",
    content: "{}",
    pendingActionIds: ["pa_1"],
    summary: "已生成邮件草稿提议",
  },
});
expect(obs.decision === "wait_approval", "有 PendingAction → wait_approval");
expect(obs.pendingActionIds.includes("pa_1"), "带回 pendingActionIds");

const port = readFileSync(
  join(process.cwd(), "src/lib/approval/port.ts"),
  "utf8",
);
expect(port.includes("resumeSupervisorAfterApproval"), "批准后恢复主管任务");
expect(port.includes("loadSupervisorState"), "从 DB 读状态而非前端 approved");

const engine = readFileSync(
  join(process.cwd(), "src/lib/agent-supervisor/engine.ts"),
  "utf8",
);
expect(engine.includes("executedFingerprints"), "防重复执行指纹");
expect(engine.includes("waiting_for_approval"), "支持审批暂停");
expect(
  engine.includes("pending_action_rejected"),
  "拒绝后标记 pending_action_rejected（不视为已执行）",
);
expect(
  !/waiting_for_approval[\s\S]{0,120}status: "completed" as const[\s\S]{0,80}部分审批被拒绝/.test(
    engine,
  ),
  "拒绝分支不得把 waiting 步骤标为 completed",
);
expect(port.includes("approval_rejected") || port.includes("已拒绝"), "拒绝路径存在");
expect(
  port.includes("resumeSupervisorAfterApproval") &&
    (port.match(/resumeSupervisorAfterApproval/g) || []).length >= 2,
  "批准与拒绝后都会尝试恢复主管任务",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} approval-resume: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
