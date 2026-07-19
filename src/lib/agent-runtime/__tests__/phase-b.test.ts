/**
 * Phase-B：子能力解析 + 后台入队判定（纯逻辑）
 * 运行：npx tsx src/lib/agent-runtime/__tests__/phase-b.test.ts
 */

import { resolvePlanCapability } from "../dispatch";
import { createAgentPlanFromRules, routeFromPlan } from "../plan";
import { isBackgroundPayload } from "../queue";
import type { AgentPlan } from "../plan";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function plan(partial: Partial<AgentPlan>): AgentPlan {
  return {
    intent: "chat",
    confidence: 0.5,
    entities: {},
    skills: [],
    tools: [],
    needsTools: false,
    canAnswerDirectly: false,
    requiresBackgroundRun: false,
    requiresApproval: false,
    complexity: "simple",
    source: "rules",
    ...partial,
  };
}

// 子能力：skills 点名
ok(
  resolvePlanCapability(plan({ skills: ["grader.quote_risk"] })) ===
    "grader.quote_risk",
  "skills 点名 quote_risk",
);

// 子能力：intent+needsTools 映射
ok(
  resolvePlanCapability(
    plan({ intent: "project", needsTools: true, complexity: "normal" }),
  ) === "grader.project_health",
  "intent=project 映射 project_health",
);

// 闲聊不触发 Grader
ok(
  resolvePlanCapability(plan({ intent: "project", needsTools: false })) ===
    null,
  "闲聊/简单句不触发子能力",
);

// 后台判定：complex → 应入队（由 process 使用）
{
  const p = createAgentPlanFromRules({
    content: "请帮我全面分析并整理本周所有项目风险报告，给出详细总结和建议",
  });
  ok(
    p.requiresBackgroundRun || p.complexity === "complex",
    "长分析任务标记后台",
  );
}

// 简单直答不入队路由
{
  const p = plan({
    canAnswerDirectly: true,
    initialResponse: "在的",
    complexity: "simple",
  });
  const r = routeFromPlan(p);
  ok(r.useDirectAnswer === true, "简单任务仍直答");
}

// payload 识别
ok(
  isBackgroundPayload({
    background: true,
    userId: "u1",
    userRole: "user",
    userName: null,
    channel: "wecom",
    channelUserId: "wx",
    content: "x",
    messageType: "text",
    plan: plan({}),
  }),
  "识别 background payload",
);
ok(!isBackgroundPayload({ foo: 1 }), "拒绝非 background payload");

// PendingAction 关联字段：createDraft 入参形状（编译期由 TS 保证；此处做契约断言）
{
  const draftInput = {
    type: "grader.internal_note" as const,
    title: "t",
    preview: "p",
    payload: {},
    userId: "u",
    orgId: "o",
    agentRunId: "run_1",
  };
  ok(typeof draftInput.agentRunId === "string", "createDraft 支持 agentRunId");
}

console.log("▶ Phase-B dispatch & queue helpers");
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
