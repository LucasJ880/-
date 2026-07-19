/**
 * 结构化 Plan 解析 / 路由 / 安全清洗
 * 运行：npx tsx src/lib/agent-runtime/__tests__/plan.test.ts
 */

import {
  createAgentPlanFromRules,
  extractPlanJson,
  parseAndSanitizeAgentPlan,
  routeFromPlan,
} from "../plan";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// extract JSON
{
  const j = extractPlanJson('```json\n{"intent":"chat","confidence":0.9}\n```');
  ok(!!j && (j as { intent: string }).intent === "chat", "提取 fenced JSON");
}
{
  const j = extractPlanJson('前言 {"intent":"email","confidence":0.8} 后记');
  ok(!!j && (j as { intent: string }).intent === "email", "提取夹杂文本 JSON");
}

// 规则 fallback 基线
{
  const p = createAgentPlanFromRules({ content: "你好" });
  ok(p.source === "rules", "规则计划 source=rules");
  ok(p.canAnswerDirectly === true, "问候可直答");
}

// 解析：剥离 orgId/userId
{
  const p = parseAndSanitizeAgentPlan(
    {
      intent: "chat",
      confidence: 0.9,
      orgId: "evil_org",
      userId: "evil_user",
      entities: {},
      needsTools: false,
      canAnswerDirectly: true,
      requiresBackgroundRun: false,
      requiresApproval: false,
      complexity: "simple",
      initialResponse: "好的",
      tools: [],
      skills: [],
    },
    {},
  );
  ok(!!p, "合法结构可解析");
  ok(p!.initialResponse === "好的", "保留 initialResponse");
  ok(p!.source === "llm", "解析来源标记 llm");
}

// 需要工具时禁止直答
{
  const p = parseAndSanitizeAgentPlan(
    {
      intent: "project",
      confidence: 0.8,
      needsTools: true,
      canAnswerDirectly: true,
      initialResponse: "我去查一下",
      requiresApproval: false,
      requiresBackgroundRun: false,
      complexity: "normal",
      tools: [{ name: "sales.get_overview", arguments: {} }],
      skills: [],
      entities: {},
    },
    {},
  );
  ok(p!.canAnswerDirectly === false, "needsTools 时禁止直答");
  ok(p!.needsTools === true, "needsTools 保留");
}

// 禁止发送类工具提示
{
  const p = parseAndSanitizeAgentPlan(
    {
      intent: "email",
      confidence: 0.9,
      needsTools: true,
      canAnswerDirectly: false,
      requiresApproval: true,
      requiresBackgroundRun: false,
      complexity: "normal",
      tools: [
        { name: "sales.send_quote_email", arguments: { to: "a@b.com" } },
        { name: "sales.compose_email", arguments: {} },
      ],
      skills: [],
      entities: {},
    },
    {},
  );
  ok(
    p!.tools.every((t) => !t.name.includes("send_quote_email")),
    "过滤发送邮件工具提示",
  );
  ok(
    p!.tools.some((t) => t.name === "sales.compose_email"),
    "保留 compose 提示",
  );
  ok(p!.requiresApproval === true, "审批标记保留");
}

// 路由：直答
{
  const plan = parseAndSanitizeAgentPlan(
    {
      intent: "chat",
      confidence: 1,
      needsTools: false,
      canAnswerDirectly: true,
      initialResponse: "在的",
      requiresApproval: false,
      requiresBackgroundRun: false,
      complexity: "simple",
      tools: [],
      skills: [],
      entities: {},
    },
    {},
  )!;
  const r = routeFromPlan(plan);
  ok(r.useDirectAnswer === true, "简单问题直答路由");
  ok(r.maxToolRounds === 0, "直答无工具轮次");
}

// 路由：需要工具走 chat
{
  const plan = parseAndSanitizeAgentPlan(
    {
      intent: "customer",
      confidence: 0.8,
      needsTools: true,
      canAnswerDirectly: false,
      requiresApproval: false,
      requiresBackgroundRun: false,
      complexity: "normal",
      tools: [{ name: "sales.get_overview", arguments: {} }],
      skills: [],
      entities: {},
    },
    {},
  )!;
  const r = routeFromPlan(plan);
  ok(r.useDirectAnswer === false, "查数不直答");
  ok(r.mode === "chat", "查数用 chat 主模型");
  ok(r.maxToolRounds === 2, "工具轮次预算 2");
}

// 非法 intent 回落 chat
{
  const p = parseAndSanitizeAgentPlan(
    {
      intent: "hack_admin",
      confidence: 0.1,
      needsTools: false,
      canAnswerDirectly: false,
      requiresApproval: false,
      requiresBackgroundRun: false,
      complexity: "simple",
      tools: [],
      skills: [],
      entities: {},
    },
    { projectId: "p1" },
  );
  ok(p!.intent === "chat", "非法 intent → chat");
  ok(p!.entities.projectId === "p1", "fallback 实体保留");
}

console.log("▶ AgentPlan structured routing");
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
