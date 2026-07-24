/**
 * Runtime V2 Verifier + 安全策略纯逻辑
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/verifier-security.test.ts
 */

import { VerifierOutputSchema } from "../schemas";
import { isAgentRuntimeV2EnabledWithEnv, looksLikeRuntimeV2Goal } from "../flags";
import { sanitizePlannerOutput, buildSalesFollowupGoldenPlan } from "../planner";
import { RUNTIME_V2_TOOL_CATALOG } from "../tool-catalog";

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

/** 模拟确定性验证裁决（与 verifier.ts 规则对齐） */
function mockDeterministicVerdict(input: {
  requiredStepsFailed: boolean;
  awaitingApproval: boolean;
  missingDbEvidence: boolean;
  crossOrgEvidence: boolean;
  repairAttempt: number;
  maxRepairs: number;
}): "PASS" | "REPAIR" | "NEEDS_HUMAN" | "BLOCKED" {
  if (input.crossOrgEvidence) return "NEEDS_HUMAN";
  if (input.awaitingApproval) return "BLOCKED";
  if (input.requiredStepsFailed || input.missingDbEvidence) {
    if (input.repairAttempt >= input.maxRepairs) return "NEEDS_HUMAN";
    return "REPAIR";
  }
  return "PASS";
}

console.log("▶ Agent Runtime V2 — Verifier / Security");

ok(
  mockDeterministicVerdict({
    requiredStepsFailed: false,
    awaitingApproval: false,
    missingDbEvidence: false,
    crossOrgEvidence: false,
    repairAttempt: 0,
    maxRepairs: 2,
  }) === "PASS",
  "完成标准全部满足 → PASS",
);

ok(
  mockDeterministicVerdict({
    requiredStepsFailed: false,
    awaitingApproval: false,
    missingDbEvidence: true,
    crossOrgEvidence: false,
    repairAttempt: 0,
    maxRepairs: 2,
  }) === "REPAIR",
  "缺少数据库记录 → REPAIR",
);

ok(
  mockDeterministicVerdict({
    requiredStepsFailed: true,
    awaitingApproval: false,
    missingDbEvidence: true,
    crossOrgEvidence: false,
    repairAttempt: 2,
    maxRepairs: 2,
  }) === "NEEDS_HUMAN",
  "修复两次失败 → NEEDS_HUMAN",
);

ok(
  mockDeterministicVerdict({
    requiredStepsFailed: false,
    awaitingApproval: true,
    missingDbEvidence: false,
    crossOrgEvidence: false,
    repairAttempt: 0,
    maxRepairs: 2,
  }) === "BLOCKED",
  "仍待审批 → BLOCKED（不得 PASS）",
);

ok(
  mockDeterministicVerdict({
    requiredStepsFailed: false,
    awaitingApproval: false,
    missingDbEvidence: false,
    crossOrgEvidence: true,
    repairAttempt: 0,
    maxRepairs: 2,
  }) === "NEEDS_HUMAN",
  "跨组织证据 → NEEDS_HUMAN",
);

{
  const parsed = VerifierOutputSchema.safeParse({
    verdict: "PASS",
    summary: "证据不足也声称完成",
    satisfiedCriteria: [],
    unsatisfiedCriteria: ["缺少草稿"],
    evidenceReferences: [],
    repairInstructions: [],
  });
  // Schema 允许此结构；业务层不得据此 PASS——此处断言业务 mock 不会 PASS
  ok(parsed.success, "Schema 可解析");
  ok(
    mockDeterministicVerdict({
      requiredStepsFailed: false,
      awaitingApproval: false,
      missingDbEvidence: true,
      crossOrgEvidence: false,
      repairAttempt: 0,
      maxRepairs: 2,
    }) !== "PASS",
    "证据不足不得 PASS",
  );
}

// 安全：伪造/非白名单
ok(
  !isAgentRuntimeV2EnabledWithEnv(
    { orgId: "forged-org", userId: "cmmy6zimk0000ju04hrln3yqv", role: "admin" },
    {
      AGENT_RUNTIME_V2_ENABLED: "1",
      AGENT_RUNTIME_V2_ORG_ALLOWLIST: "cmrtcnz1c0001sbjcy87hemyl",
      AGENT_RUNTIME_V2_USER_ALLOWLIST: "cmmy6zimk0000ju04hrln3yqv",
    },
  ),
  "伪造 orgId 拒绝进入 V2",
);

ok(
  !isAgentRuntimeV2EnabledWithEnv(
    {
      orgId: "cmrtcnz1c0001sbjcy87hemyl",
      userId: "forged-user",
      role: "admin",
    },
    {
      AGENT_RUNTIME_V2_ENABLED: "1",
      AGENT_RUNTIME_V2_ORG_ALLOWLIST: "cmrtcnz1c0001sbjcy87hemyl",
      AGENT_RUNTIME_V2_USER_ALLOWLIST: "cmmy6zimk0000ju04hrln3yqv",
    },
  ),
  "伪造 userId 拒绝进入 V2",
);

ok(
  !isAgentRuntimeV2EnabledWithEnv(
    {
      orgId: "cmrtcnz1c0001sbjcy87hemyl",
      userId: "cmmy6zimk0000ju04hrln3yqv",
      role: "admin",
    },
    { AGENT_RUNTIME_V2_ENABLED: "0" },
  ),
  "总开关关闭时平台 admin 也不能进 V2",
);

// 写工具必须 requiresApproval
{
  const writes = RUNTIME_V2_TOOL_CATALOG.filter((t) => !t.readOnly);
  ok(
    writes.length > 0 && writes.every((t) => t.requiresApproval),
    "所有写工具 requiresApproval=true",
  );
  ok(
    !RUNTIME_V2_TOOL_CATALOG.some((t) => /send/i.test(t.name) && t.name.includes("gmail")),
    "目录中无 gmail send 工具",
  );
}

// 黄金计划写步骤全部审批
{
  const r = sanitizePlannerOutput(
    buildSalesFollowupGoldenPlan(),
    RUNTIME_V2_TOOL_CATALOG,
    8,
  );
  ok(r.ok === true, "黄金计划可 sanitize");
  if (r.ok) {
    const writeSteps = r.plan.steps.filter((s) => s.executionMode === "write");
    ok(
      writeSteps.length >= 3 && writeSteps.every((s) => s.requiresApproval),
      "写步骤全部 requiresApproval，不可绕过",
    );
  }
}

ok(
  looksLikeRuntimeV2Goal("帮我把最近的销售跟进处理一下") &&
    !looksLikeRuntimeV2Goal("报价多少钱"),
  "非复杂目标不进 V2 启发式",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
