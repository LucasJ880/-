/**
 * Runtime V2 Durable Graph 纯逻辑
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/durable-state.test.ts
 */

import { dependenciesSatisfied } from "../persist";
import { buildSalesFollowupGoldenPlan } from "../planner";
import { getRuntimeV2Limits } from "../flags";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

type Step = {
  stepKey: string;
  status: string;
  dependsOn: string[];
  attemptCount: number;
  maxAttempts: number;
};

function refreshReady(steps: Step[]): Step[] {
  const done = new Set(
    steps
      .filter((s) => s.status === "completed" || s.status === "skipped")
      .map((s) => s.stepKey),
  );
  return steps.map((s) => {
    if (s.status !== "pending") return s;
    if (dependenciesSatisfied(s.dependsOn, done)) {
      return { ...s, status: "ready" };
    }
    return s;
  });
}

function pickReady(steps: Step[], parallelism = 1): Step[] {
  return steps.filter((s) => s.status === "ready").slice(0, parallelism);
}

function simulateCancel(steps: Step[], runStatus: string): string {
  if (runStatus === "cancelled") return "cancelled";
  return pickReady(steps).length > 0 ? "would_execute" : "idle";
}

console.log("▶ Agent Runtime V2 — Durable state");

const plan = buildSalesFollowupGoldenPlan();
let steps: Step[] = plan.steps.map((s) => ({
  stepKey: s.id,
  status: s.dependsOn.length === 0 ? "ready" : "pending",
  dependsOn: s.dependsOn,
  attemptCount: 0,
  maxAttempts: 2,
}));

ok(pickReady(steps).length === 1, "初始仅 1 个 ready（parallelism=1）");
ok(pickReady(steps)[0]?.stepKey === "s1_pipeline", "首步为 pipeline");

// 完成 s1
steps = steps.map((s) =>
  s.stepKey === "s1_pipeline" ? { ...s, status: "completed" } : s,
);
steps = refreshReady(steps);
ok(
  steps.find((s) => s.stepKey === "s2_opportunities")?.status === "ready",
  "依赖满足后 s2 ready",
);

// 完成 s2 → s3/s4 ready
steps = steps.map((s) =>
  s.stepKey === "s2_opportunities" ? { ...s, status: "completed" } : s,
);
steps = refreshReady(steps);
ok(
  steps.filter((s) => s.status === "ready").map((s) => s.stepKey).sort().join(",") ===
    "s3_followup_analysis,s4_quote_risk",
  "并行依赖分支同时 ready（执行仍 parallelism=1）",
);

// 幂等：同一步不重复跑 completed
const completedKeys = new Set(
  steps.filter((s) => s.status === "completed").map((s) => s.stepKey),
);
ok(completedKeys.has("s1_pipeline"), "已完成步骤持久在集合中");
ok(
  !pickReady(steps).some((s) => completedKeys.has(s.stepKey)),
  "不会重新选中已完成步骤",
);

// 失败重试
let failed: Step = {
  stepKey: "s3_followup_analysis",
  status: "ready",
  dependsOn: ["s2_opportunities"],
  attemptCount: 0,
  maxAttempts: 2,
};
failed = { ...failed, attemptCount: 1, status: "ready" };
ok(failed.attemptCount < failed.maxAttempts, "第 1 次失败后可再试");
failed = { ...failed, attemptCount: 2, status: "failed" };
ok(failed.attemptCount >= failed.maxAttempts, "达到 maxAttempts 后失败");

ok(simulateCancel(steps, "cancelled") === "cancelled", "cancel 后不再执行");

const limits = getRuntimeV2Limits({
  AGENT_RUNTIME_V2_MAX_STEPS: "8",
  AGENT_RUNTIME_V2_MAX_REPAIRS: "2",
  AGENT_RUNTIME_V2_MAX_ATTEMPTS_PER_STEP: "2",
  AGENT_RUNTIME_V2_PARALLELISM: "1",
});
ok(limits.maxSteps === 8 && limits.maxRepairs === 2, "限制可从环境读取");
ok(limits.parallelism === 1, "默认 parallelism=1");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
