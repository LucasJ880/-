/**
 * 动态规划 Fixture — 证明不是固定工作流
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/dynamic-replan.test.ts
 */
import { observeStepResult } from "../observer";
import { applyObserverPlanAdjustments, replanSupervisor } from "../replanner";
import type { SupervisorState, SupervisorStep } from "../types";
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

function base(plan: SupervisorStep[]): SupervisorState {
  return {
    sessionId: "s",
    runId: "r",
    orgId: "o",
    userId: "u",
    originalRequest: "x",
    objective: "x",
    resolvedContext: { availableSkills: [] },
    mode: "supervisor",
    complexity: {
      mode: "supervisor",
      reason: "fixture",
      confidence: 1,
      candidateWorker: "sales",
      candidateSkills: plan.map((p) => p.skillSlug),
      requiresApproval: false,
    },
    plan,
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
}

async function main() {
  // Fixture 1：销售高价值机会 → 跳过拓客，保留/插入 next-best-action
  const salesPlan: SupervisorStep[] = [
    {
      id: "s1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-pipeline-forecast",
      objective: "管道",
      input: {},
      dependsOn: [],
      status: "completed",
      mayCreatePendingAction: false,
      resultSummary:
        '{"buckets":{"Commit":{"count":1,"amount":50000}},"opportunities":[{"probability":0.8,"name":"高价值","daysSinceFollowup":20}]} 超过14天未跟进',
    },
    {
      id: "s2",
      order: 2,
      worker: "sales",
      skillSlug: "sales-icp-prospect-scoring",
      objective: "新潜客开发评分",
      input: {},
      dependsOn: ["s1"],
      status: "pending",
      mayCreatePendingAction: false,
    },
    {
      id: "s3",
      order: 3,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "本周行动",
      input: {},
      dependsOn: ["s1"],
      status: "pending",
      mayCreatePendingAction: true,
    },
  ];
  const obs1 = observeStepResult({
    state: base(salesPlan),
    stepId: "s1",
    workerResult: {
      ok: true,
      skillSlug: "sales-pipeline-forecast",
      content: salesPlan[0].resultSummary || "",
      pendingActionIds: [],
      summary: salesPlan[0].resultSummary || "",
    },
  });
  expect(obs1.decision === "replan", "Fixture1 Observer → replan");
  const adjusted1 = applyObserverPlanAdjustments(salesPlan, obs1.reason);
  expect(
    adjusted1.find((s) => s.id === "s2")?.status === "skipped",
    "Fixture1 跳过新潜客步骤",
  );
  expect(
    adjusted1.find((s) => s.id === "s3")?.status === "pending",
    "Fixture1 保留 next-best-action",
  );
  console.log(
    "Fixture1 初始计划 →",
    salesPlan.map((s) => s.skillSlug).join(", "),
  );
  console.log("Fixture1 Observer →", obs1.decision, obs1.reason);
  console.log(
    "Fixture1 调整后 →",
    adjusted1.map((s) => `${s.skillSlug}:${s.status}`).join(", "),
  );

  // Fixture 2：投标致命缺口 → 跳过合规矩阵
  const tenderPlan: SupervisorStep[] = [
    {
      id: "t1",
      order: 1,
      worker: "tender",
      skillSlug: "tender-bid-no-bid",
      objective: "去留",
      input: {},
      dependsOn: [],
      status: "completed",
      mayCreatePendingAction: false,
      resultSummary:
        '{"decision":"abandon","recommendation":"no","summary":"必须认证缺失，无法在截止日前取得"}',
    },
    {
      id: "t2",
      order: 2,
      worker: "tender",
      skillSlug: "tender-mandatory-compliance-matrix",
      objective: "强制条件矩阵",
      input: {},
      dependsOn: ["t1"],
      status: "pending",
      mayCreatePendingAction: false,
    },
  ];
  const obs2 = observeStepResult({
    state: base(tenderPlan),
    stepId: "t1",
    workerResult: {
      ok: true,
      skillSlug: "tender-bid-no-bid",
      content: tenderPlan[0].resultSummary || "",
      pendingActionIds: [],
      summary: tenderPlan[0].resultSummary || "",
    },
  });
  expect(obs2.decision === "replan", "Fixture2 Observer → replan");
  const replanned = await replanSupervisor(base(tenderPlan), obs2.reason);
  expect(
    !replanned.plan.some(
      (s) =>
        s.skillSlug === "tender-mandatory-compliance-matrix" &&
        s.status === "pending",
    ),
    "Fixture2 不再 pending 完整合规矩阵",
  );
  console.log(
    "Fixture2 初始计划 →",
    tenderPlan.map((s) => s.skillSlug).join(", "),
  );
  console.log("Fixture2 Observer →", obs2.decision, obs2.reason);
  console.log(
    "Fixture2 最终计划 →",
    replanned.plan.map((s) => `${s.skillSlug}:${s.status}`).join(", "),
  );

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} dynamic-replan: ${total - failed}/${total}`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
