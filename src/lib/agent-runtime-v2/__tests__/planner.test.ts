/**
 * Runtime V2 Planner 专项测试
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/planner.test.ts
 */

import {
  buildSalesFollowupGoldenPlan,
  sanitizePlannerOutput,
} from "../planner";
import { RUNTIME_V2_TOOL_CATALOG } from "../tool-catalog";
import { looksLikeRuntimeV2Goal, isAgentRuntimeV2EnabledWithEnv } from "../flags";
import { VerifierOutputSchema } from "../schemas";
import { dependenciesSatisfied } from "../persist";

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

console.log("▶ Agent Runtime V2 — Planner / Flags / Verifier schema");

{
  const golden = buildSalesFollowupGoldenPlan();
  const r = sanitizePlannerOutput(golden, RUNTIME_V2_TOOL_CATALOG, 8);
  ok(r.ok === true, "黄金计划通过 Zod + sanitize");
  if (r.ok) {
    ok(r.plan.steps.length <= 8, "黄金计划步骤 ≤ 8");
    ok(
      r.plan.steps.every(
        (s) => !s.preferredTool || RUNTIME_V2_TOOL_CATALOG.some((t) => t.name === s.preferredTool),
      ),
      "黄金计划工具均在目录内",
    );
  }
}

{
  const golden = buildSalesFollowupGoldenPlan();
  const poisoned = {
    ...golden,
    steps: [
      ...golden.steps,
      {
        id: "bad",
        title: "非法工具",
        description: "x",
        dependsOn: [],
        preferredTool: "shell.exec_rm_rf",
        executionMode: "write" as const,
        riskLevel: "CRITICAL" as const,
        requiresApproval: true,
        expectedOutput: "x",
      },
    ],
  };
  const r = sanitizePlannerOutput(poisoned, RUNTIME_V2_TOOL_CATALOG, 8);
  ok(r.ok === true, "非法 tool 被清除后仍可接受（裁剪+清除）");
  if (r.ok) {
    ok(
      !r.plan.steps.some((s) => s.preferredTool === "shell.exec_rm_rf"),
      "非法 tool 不得保留",
    );
    ok(r.plan.steps.length <= 8, "超步数被裁剪到 maxSteps");
  }
}

{
  const golden = buildSalesFollowupGoldenPlan();
  const clarify = {
    ...golden,
    needsClarification: true,
    clarificationQuestion: "请问要处理哪个客户？",
  };
  const r = sanitizePlannerOutput(clarify, RUNTIME_V2_TOOL_CATALOG, 8);
  ok(r.ok === false && !!r.clarification, "缺少阻断信息时生成 clarification");
}

{
  const simple = {
    objective: "查一下今天天气",
    summary: "简单闲聊",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      {
        id: "c1",
        description: "回答问题",
        verificationType: "model_judgement" as const,
      },
    ],
    steps: [
      {
        id: "s1",
        title: "直接回答",
        description: "无需多工具",
        dependsOn: [],
        executionMode: "analysis" as const,
        riskLevel: "LOW" as const,
        requiresApproval: false,
        expectedOutput: "一句话回答",
      },
    ],
  };
  const r = sanitizePlannerOutput(simple, RUNTIME_V2_TOOL_CATALOG, 8);
  ok(r.ok && r.plan.steps.length === 1, "简单任务不会过度计划");
}

ok(
  looksLikeRuntimeV2Goal("帮我把最近的销售跟进处理一下。"),
  "黄金目标命中 V2 启发式",
);
ok(!looksLikeRuntimeV2Goal("你好"), "闲聊不命中 V2");

ok(
  !isAgentRuntimeV2EnabledWithEnv(
    { orgId: "o1", userId: "u1", role: "admin" },
    { AGENT_RUNTIME_V2_ENABLED: "1" },
  ),
  "仅开总开关、无白名单 → 关闭",
);
ok(
  isAgentRuntimeV2EnabledWithEnv(
    { orgId: "cmrtcnz1c0001sbjcy87hemyl", userId: "cmmy6zimk0000ju04hrln3yqv", role: "admin" },
    {
      AGENT_RUNTIME_V2_ENABLED: "1",
      AGENT_RUNTIME_V2_ORG_ALLOWLIST: "cmrtcnz1c0001sbjcy87hemyl",
      AGENT_RUNTIME_V2_USER_ALLOWLIST: "cmmy6zimk0000ju04hrln3yqv",
    },
  ),
  "Sunny+Lucas 白名单开启",
);
ok(
  !isAgentRuntimeV2EnabledWithEnv(
    { orgId: "cmrtcnz1c0001sbjcy87hemyl", userId: "other-user", role: "sales" },
    {
      AGENT_RUNTIME_V2_ENABLED: "1",
      AGENT_RUNTIME_V2_ORG_ALLOWLIST: "cmrtcnz1c0001sbjcy87hemyl",
      AGENT_RUNTIME_V2_USER_ALLOWLIST: "cmmy6zimk0000ju04hrln3yqv",
    },
  ),
  "同组织非白名单用户关闭",
);

{
  const v = VerifierOutputSchema.safeParse({
    verdict: "PASS",
    summary: "ok",
    satisfiedCriteria: ["a"],
    unsatisfiedCriteria: [],
    evidenceReferences: ["e1"],
    repairInstructions: [],
  });
  ok(v.success, "Verifier 输出 Schema 合法");
  const bad = VerifierOutputSchema.safeParse({
    verdict: "MAYBE",
    summary: "x",
    satisfiedCriteria: [],
    unsatisfiedCriteria: [],
    evidenceReferences: [],
    repairInstructions: [],
  });
  ok(!bad.success, "非法 verdict 被拒绝");
}

ok(
  dependenciesSatisfied(["a", "b"], new Set(["a", "b", "c"])),
  "依赖满足",
);
ok(
  !dependenciesSatisfied(["a", "b"], new Set(["a"])),
  "依赖未满足",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
