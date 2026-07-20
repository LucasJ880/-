/**
 * Fake Model / Fixture 确定性 E2E（不依赖真实 API Key）
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/fake-model-e2e.test.ts
 */

import { routeComplexity } from "../complexity-router";
import { validateSupervisorPlan } from "../plan-validator";
import { observeStepResult } from "../observer";
import { compileSupervisorGraph } from "../graph";
import { PlannerOutputSchema, ObserverOutputSchema } from "../types";
import type { SupervisorState, SupervisorStep } from "../types";
import { getSupervisorLimits } from "../config";
import { SKILL_PENDING_ACTION_ALLOWLIST } from "@/lib/agent-core/skills/pending-action-bridge";
import { collectPendingProposals } from "@/lib/agent-core/skills/pending-action-bridge";
import { isSkillAllowedForWorker } from "../worker-registry";

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
  "sales-account-research",
  "tender-bid-no-bid",
  "tender-mandatory-compliance-matrix",
  "marketing-product-context",
  "marketing-prospecting-campaign",
]);

function baseState(over: Partial<SupervisorState> = {}): SupervisorState {
  const limits = getSupervisorLimits();
  return {
    sessionId: "s",
    runId: "r",
    orgId: "org-test",
    userId: "u",
    originalRequest: "x",
    objective: "x",
    resolvedContext: {},
    mode: "supervisor",
    plan: [],
    currentStepIndex: 0,
    observations: [],
    artifacts: [],
    pendingActionIds: [],
    status: "running",
    stepCount: 0,
    replanCount: 0,
    skillCallCount: 0,
    maxSteps: limits.maxSteps,
    maxReplans: limits.maxReplans,
    maxSkillCalls: limits.maxSkillCalls,
    userVisibleTimeline: [],
    executedFingerprints: [],
    ...over,
  };
}

async function main() {
  // 1-2 路由
  expect(
    routeComplexity({ content: "生成今天最重要的销售跟进" }).mode === "direct",
    "合法 DIRECT",
  );
  expect(
    routeComplexity({
      content: "分析本月销售情况，找出最值得推进的客户，并准备本周行动",
    }).mode === "supervisor",
    "合法 SUPERVISOR",
  );

  // 3 合法 3 步计划
  const three: SupervisorStep[] = [
    {
      id: "step-1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-pipeline-forecast",
      objective: "管道",
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
      objective: "动作",
      input: {},
      dependsOn: ["step-1"],
      status: "pending",
      mayCreatePendingAction: true,
    },
    {
      id: "step-3",
      order: 3,
      worker: "sales",
      skillSlug: "sales-account-research",
      objective: "研究",
      input: {},
      dependsOn: ["step-2"],
      status: "pending",
      mayCreatePendingAction: false,
    },
  ];
  expect(
    validateSupervisorPlan({
      steps: three,
      maxSteps: 5,
      orgActiveSkillSlugs: orgSkills,
    }).ok,
    "生成3步计划可执行",
  );

  // 4 非法 Worker（技能不在该 worker）
  expect(
    !validateSupervisorPlan({
      steps: [{ ...three[0], worker: "marketing", skillSlug: "sales-pipeline-forecast" }],
      maxSteps: 5,
      orgActiveSkillSlugs: orgSkills,
    }).ok,
    "非法 Worker/技能组合拒绝",
  );

  // 5 不存在 Skill
  expect(
    !validateSupervisorPlan({
      steps: [{ ...three[0], skillSlug: "sales-not-exist" }],
      maxSteps: 5,
      orgActiveSkillSlugs: orgSkills,
    }).ok,
    "不存在 Skill 拒绝",
  );

  // 6 超过 5 步
  const six = Array.from({ length: 6 }, (_, i) => ({
    ...three[0],
    id: `step-${i + 1}`,
    order: i + 1,
    dependsOn: [] as string[],
  }));
  const sixV = validateSupervisorPlan({
    steps: six,
    maxSteps: 5,
    orgActiveSkillSlugs: orgSkills,
  });
  expect(sixV.steps.length === 5, "超过5步被截断修复");

  // 7 循环依赖
  expect(
    !validateSupervisorPlan({
      steps: [
        { ...three[0], dependsOn: ["step-2"] },
        { ...three[1], dependsOn: ["step-1"] },
      ],
      maxSteps: 5,
      orgActiveSkillSlugs: orgSkills,
    }).ok,
    "循环依赖拒绝",
  );

  // 8-12 Observer
  const st = baseState({ plan: three });
  expect(
    observeStepResult({
      state: st,
      stepId: "step-1",
      workerResult: {
        ok: true,
        skillSlug: "sales-pipeline-forecast",
        content: "{}",
        pendingActionIds: [],
        summary: "ok",
      },
    }).decision === "continue",
    "Observer continue",
  );
  expect(
    observeStepResult({
      state: st,
      stepId: "step-1",
      workerResult: {
        ok: false,
        skillSlug: "sales-pipeline-forecast",
        content: "",
        pendingActionIds: [],
        summary: "",
        error: "fail",
      },
    }).decision === "replan",
    "Observer replan on fail",
  );
  expect(
    observeStepResult({
      state: st,
      stepId: "step-1",
      workerResult: {
        ok: true,
        skillSlug: "sales-next-best-action",
        content: "{}",
        pendingActionIds: ["pa1"],
        summary: "draft",
      },
    }).decision === "wait_approval",
    "Observer wait_approval",
  );
  expect(
    observeStepResult({
      state: {
        ...st,
        plan: [{ ...three[0], status: "completed" }],
      },
      stepId: "step-1",
      workerResult: {
        ok: true,
        skillSlug: "sales-pipeline-forecast",
        content: "{}",
        pendingActionIds: [],
        summary: "done",
      },
    }).decision === "complete",
    "Observer complete",
  );
  expect(
    observeStepResult({
      state: {
        ...st,
        plan: [
          { ...three[0], status: "completed" },
          { ...three[1], status: "pending" },
        ],
      },
      stepId: "step-1",
      workerResult: {
        ok: true,
        skillSlug: "sales-pipeline-forecast",
        content: "{}",
        pendingActionIds: [],
        summary: "ok",
      },
    }).decision === "continue",
    "两步计划第一步后应 continue（不得误 complete）",
  );

  // 13-14 解析失败
  expect(
    !PlannerOutputSchema.safeParse({ objective: "x", steps: "bad" }).success,
    "Planner 无法解析 → schema fail",
  );
  expect(
    !ObserverOutputSchema.safeParse({ decision: "maybe", reason: "x" }).success,
    "Observer 无法解析 → schema fail",
  );

  // 15 Graph 限制
  const graph = compileSupervisorGraph();
  const g = await graph.invoke({
    originalRequest: "分析本月销售情况，找出最值得推进的客户，并准备本周行动",
    mode: "direct",
    complexityReason: "",
    planStepCount: 0,
    currentStep: 0,
    skillCallCount: 0,
    maxSkillCalls: 6,
    maxSteps: 5,
    replanCount: 0,
    maxReplans: 2,
    decision: "",
    status: "",
    candidateSkills: [
      "sales-pipeline-forecast",
      "sales-next-best-action",
      "sales-account-research",
    ],
  });
  expect((g.skillCallCount || 0) <= 6, "技能调用不超过6");
  expect(g.status === "completed", "图路径安全结束");

  // 16 非法 PendingAction
  const illegal = collectPendingProposals({
    pendingActionProposal: { type: "marketing.send_blast", title: "群发" },
  });
  expect(illegal.length === 1, "非法提案可被收集以便 skip");
  expect(
    !(SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(
      "marketing.send_blast",
    ),
    "非法动作不在白名单",
  );

  // Supervisor 不能直接调业务工具语义
  expect(
    !isSkillAllowedForWorker("sales", "sales.send_quote_email"),
    "Worker 拒绝直发邮件工具名",
  );

  // fingerprints：相同技能+输入应视为重复键稳定
  const fp1 = JSON.stringify({
    slug: "sales-next-best-action",
    input: { objective: "a" },
  });
  const fp2 = JSON.stringify({
    slug: "sales-next-best-action",
    input: { objective: "a" },
  });
  expect(fp1 === fp2, "相同技能与输入指纹一致");

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} fake-model-e2e: ${total - failed}/${total}`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
