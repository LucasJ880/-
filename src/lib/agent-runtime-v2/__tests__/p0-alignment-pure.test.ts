/**
 * P0 Runtime Execution Alignment — 纯逻辑不变量（#88/#89/#90A）
 *
 * P0-G1 Catalog Alignment（PLANNER_VISIBLE ⊆ EXECUTABLE，ghost=0）
 * + #90A deterministic hard floor 纯函数
 * + synthesis 契约校验 / bounded input / 输出 schema
 * + #89 语义证据识别（模型命名步骤键）
 *
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/p0-alignment-pure.test.ts
 */

import {
  RUNTIME_V2_TOOL_CATALOG,
  plannerVisibleRuntimeV2Tools,
} from "../tool-catalog";
import {
  isRuntimeV2ToolExecutable,
  listExecutableRuntimeV2ToolNames,
  findFollowupAnalysisEvidence,
  findQuoteRiskEvidence,
  findOpportunityListEvidence,
  findPrioritizedEvidence,
  deriveCustomerTargetIds,
} from "../adapters";
import { applyDeterministicHardFloor } from "../verifier";
import type { VerifierOutput } from "../schemas";
import { buildSalesFollowupGoldenPlan, sanitizePlannerOutput } from "../planner";
import { applyWorkforceTaskSpecs } from "@/lib/workforce-runtime/task-contract";
import {
  buildBoundedSynthesisInput,
  WorkforceSynthesisResultV1Schema,
  WORKFORCE_SYNTHESIS_LIMITS,
  WORKFORCE_SYNTHESIS_EXECUTION_LABEL,
} from "@/lib/workforce-runtime/synthesis";
import type { PlannerOutput } from "../schemas";
import type { UpstreamHandoff } from "@/lib/workforce-runtime/handoff";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

console.log("▶ P0 Execution Alignment — 纯逻辑不变量");

// ══ P0-G1：PLANNER_VISIBLE ⊆ EXECUTABLE（永久不变量）══
console.log("\n[P0-G1 Catalog ↔ Execution Alignment]");
{
  const visible = plannerVisibleRuntimeV2Tools();
  const executable = new Set(listExecutableRuntimeV2ToolNames());
  const ghosts = visible.filter((t) => !executable.has(t.name));
  ok(
    ghosts.length === 0,
    `G1: GHOST_TOOL_COUNT = 0（planner 可见 ${visible.length} 个全部可执行）`,
    ghosts.map((t) => t.name),
  );
  ok(
    visible.every((t) => isRuntimeV2ToolExecutable(t.name)),
    "G1: isRuntimeV2ToolExecutable 对每个 planner 可见工具为 true",
  );
  // 当前目录 13 个工具全部实现（含曾经的 5 个 ghost）
  const catalogNames = RUNTIME_V2_TOOL_CATALOG.map((t) => t.name);
  const unimplemented = catalogNames.filter(
    (n) => !isRuntimeV2ToolExecutable(n),
  );
  ok(
    unimplemented.length === 0 && catalogNames.length === 13,
    "G1: 全目录 13 个工具均有 server execution path（原 5 个 ghost 已实现）",
    unimplemented,
  );
  const formerGhosts = [
    "sales_search_customers",
    "sales_get_customer",
    "sales_get_customer_interactions",
    "sales_get_customer_quotes",
    "calendar_create_event_draft",
  ];
  ok(
    formerGhosts.every((n) => isRuntimeV2ToolExecutable(n)),
    "G1: 验证报告列出的 5 个 ghost tool 全部可执行",
  );
  // EXECUTABLE ⊋ PLANNER_VISIBLE 方向允许：synthesis 执行标签不是工具、
  // 不在目录中（runtime 内部执行模式）
  ok(
    !catalogNames.includes(WORKFORCE_SYNTHESIS_EXECUTION_LABEL) &&
      !executable.has(WORKFORCE_SYNTHESIS_EXECUTION_LABEL),
    "G1: workforce_synthesis 是执行模式标签，不进入工具目录/注册表",
  );
}

// 投影 fail-closed：目录中出现无 handler 的条目会被 planner 投影过滤
{
  const fake = {
    name: "p0_fake_ghost_tool",
    description: "no handler",
    riskLevel: "LOW" as const,
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web"],
  };
  RUNTIME_V2_TOOL_CATALOG.push(fake);
  try {
    const visible = plannerVisibleRuntimeV2Tools();
    ok(
      !visible.some((t) => t.name === "p0_fake_ghost_tool"),
      "G1: 无 handler 的目录条目被 planner 投影 fail-closed 过滤",
    );
  } finally {
    const idx = RUNTIME_V2_TOOL_CATALOG.findIndex(
      (t) => t.name === "p0_fake_ghost_tool",
    );
    if (idx >= 0) RUNTIME_V2_TOOL_CATALOG.splice(idx, 1);
  }
}

// ══ #90A deterministic hard floor（§27）══
console.log("\n[#90A Deterministic Hard Floor]");
{
  const det = (verdict: VerifierOutput["verdict"]): VerifierOutput => ({
    verdict,
    summary: "deterministic",
    satisfiedCriteria: [],
    unsatisfiedCriteria: verdict === "PASS" ? [] : ["必需写任务终态失败"],
    evidenceReferences: verdict === "PASS" ? [] : ["step:w1:failed"],
    repairInstructions: [],
  });
  const model = (verdict: VerifierOutput["verdict"]): VerifierOutput => ({
    verdict,
    summary: "model",
    satisfiedCriteria: ["模型断言无失败项"],
    unsatisfiedCriteria: [],
    evidenceReferences: [],
    repairInstructions: [],
  });
  ok(
    applyDeterministicHardFloor(det("NEEDS_HUMAN"), model("PASS")).verdict ===
      "NEEDS_HUMAN",
    "G7-floor: deterministic NEEDS_HUMAN + 模型 PASS → 最终 NEEDS_HUMAN",
  );
  ok(
    applyDeterministicHardFloor(det("REPAIR"), model("PASS")).verdict ===
      "REPAIR",
    "G7-floor: deterministic REPAIR + 模型 PASS → 最终 REPAIR（不得解除）",
  );
  ok(
    applyDeterministicHardFloor(det("PASS"), model("REPAIR")).verdict ===
      "REPAIR",
    "G7-floor: 模型可以降级 PASS → REPAIR（只能更严格）",
  );
  ok(
    applyDeterministicHardFloor(det("PASS"), model("PASS")).verdict === "PASS",
    "G7-floor: 双方 PASS → PASS",
  );
}

// ══ Synthesis 契约校验（§17–§18）══
console.log("\n[Synthesis 契约校验]");
{
  const base = {
    objective: "synthesis 契约测试",
    summary: "synthesis 契约测试",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      { id: "c1", description: "done", verificationType: "tool_result" as const },
    ],
  };
  const mk = (synthExtra: Record<string, unknown>) =>
    ({
      ...base,
      steps: [
        {
          id: "a",
          title: "读取",
          description: "读取",
          dependsOn: [],
          preferredTool: "sales_get_pipeline",
          executionMode: "read" as const,
          riskLevel: "LOW" as const,
          requiresApproval: false,
          expectedOutput: "x",
        },
        {
          id: "s",
          title: "综合",
          description: "综合",
          dependsOn: ["a"],
          executionMode: "analysis" as const,
          riskLevel: "LOW" as const,
          requiresApproval: false,
          expectedOutput: "综合结论",
          workerKey: "synthesis_worker",
          taskKind: "synthesis" as const,
          ...synthExtra,
        },
      ],
    }) as unknown as PlannerOutput;

  const valid = applyWorkforceTaskSpecs(mk({}));
  ok(
    valid.ok && !("preferredTool" in (valid.ok ? {} : {})),
    "G4-契约: synthesis 无 preferredTool 合法（不再 no_tool 前置死亡）",
  );
  const noDeps = applyWorkforceTaskSpecs(mk({ dependsOn: [] }));
  ok(
    !noDeps.ok && noDeps.code === "WORKFORCE_TASK_SPEC_INVALID",
    "G5-契约: synthesis 零依赖声明 → fail validation（输入权威=dependsOn）",
  );
  const withApproval = applyWorkforceTaskSpecs(mk({ requiresApproval: true }));
  ok(
    !withApproval.ok && withApproval.code === "WORKFORCE_TASK_SPEC_INVALID",
    "契约: synthesis + requiresApproval → fail validation（审批死锁防护）",
  );
}

// ══ Synthesis bounded input（§18 声明序 / §21 有界）══
console.log("\n[Synthesis bounded input]");
{
  const up = (stepKey: string, big = false): UpstreamHandoff => ({
    stepKey,
    payload: {
      contractVersion: "workforce-handoff/v1",
      source: { runId: "run1", stepKey, workerKey: "sales_worker" },
      summary: `${stepKey} 的业务摘要`,
      outputs: big ? { blob: "x".repeat(8000) } : { n: 1 },
      evidenceRefs: [`step:${stepKey}`],
      businessRefs: [],
      warnings: [],
      openQuestions: [],
      createdAt: new Date(0).toISOString(),
    },
  });
  const { entries, truncatedSteps } = buildBoundedSynthesisInput([
    up("task_a"),
    up("task_b", true),
    up("task_c"),
  ]);
  ok(
    entries.map((e) => e.stepKey).join(",") === "task_a,task_b,task_c",
    "G6-有界: 输入顺序 = 声明序（非大小/完成序）",
  );
  ok(
    truncatedSteps.includes("task_b") &&
      entries.find((e) => e.stepKey === "task_b")?.outputs === undefined &&
      entries.find((e) => e.stepKey === "task_b")!.summary.length > 0,
    "有界: 超预算上游弃 outputs 保 summary（deterministic 截断可审计）",
  );
  const totalBytes = Buffer.byteLength(JSON.stringify(entries), "utf8");
  ok(
    totalBytes <=
      WORKFORCE_SYNTHESIS_LIMITS.maxTotalInputBytes +
        WORKFORCE_SYNTHESIS_LIMITS.maxUpstreamInputBytes,
    "有界: 总输入不超过预算量级",
    totalBytes,
  );
}

// ══ Synthesis 输出契约 schema（§19）══
{
  const good = WorkforceSynthesisResultV1Schema.safeParse({
    summary: "综合结论",
    conclusions: ["结论一"],
    risks: ["风险一"],
    extraField: "stripped",
  });
  ok(
    good.success && !("extraField" in (good.success ? good.data : {})),
    "G4-契约: 合法综合结果通过 schema 且未知字段被 strip",
  );
  const empty = WorkforceSynthesisResultV1Schema.safeParse({
    summary: "x",
    conclusions: [],
  });
  ok(!empty.success, "契约: conclusions 至少 1 条（拒绝空转综合）");
  const concat = WorkforceSynthesisResultV1Schema.safeParse({
    summary: "拼接文本",
  });
  ok(!concat.success, "契约: 缺 conclusions 的纯文本不构成综合结果");
}

// ══ #89 语义证据识别（模型命名步骤键）══
console.log("\n[#89 语义证据识别]");
{
  // 模型命名计划：read_pipeline / followup_review / risk_review 键
  const prior: Record<string, unknown> = {
    read_pipeline: { opportunityCount: 2, byStage: { quoted: 2 }, sample: [{ id: "o1", customerId: "c1" }] },
    followup_review: { grader: "customer_followup", result: { issues: [] }, degraded: false, evidenceQuality: "FULL" },
    risk_review: { grader: "quote_risk_fallback", recentQuotes: [], degraded: true, evidenceQuality: "PARTIAL" },
  };
  ok(
    findFollowupAnalysisEvidence(prior) === prior.followup_review,
    "G3-语义: 跟进分析按 grader 标记识别（模型命名键）",
  );
  ok(
    findQuoteRiskEvidence(prior) === prior.risk_review,
    "G3-语义: 报价风险含 fallback 形态识别",
  );
  ok(
    findOpportunityListEvidence(prior).length === 1 &&
      (findOpportunityListEvidence(prior)[0] as { id?: string }).id === "o1",
    "G3-语义: 商机列表回退 pipeline sample 识别",
  );
  const withList = {
    model_step_x: { opportunities: [{ id: "o9" }] },
    ...prior,
  };
  ok(
    (findOpportunityListEvidence(withList)[0] as { id?: string }).id === "o9",
    "G3-语义: opportunities 数组优先于 pipeline sample",
  );

  const prio = {
    rank_result: {
      prioritized: [
        { customerId: "c1", customerName: "客户一", opportunityId: "o1", email: "a@b.c", reasons: ["r1"] },
        { customerId: "c2", customerName: "客户二" },
      ],
    },
  };
  const found = findPrioritizedEvidence(prio);
  ok(
    found.length === 2 && found[0].customerId === "c1" && found[0].opportunityId === "o1",
    "G3-语义: prioritized 列表按形状识别（写任务不再读 s5_prioritize 字面键）",
  );

  const targets = deriveCustomerTargetIds({
    a: { prioritized: [{ customerId: "c1", customerName: "n" }] },
    b: { customers: [{ id: "c2" }, { id: "c3" }] },
    c: { customerId: "c4" },
    d: {
      workforceHandoff: {
        contractVersion: "workforce-handoff/v1",
        businessRefs: ["customer:c5", "opportunity:o1", "customer:c6"],
      },
    },
  });
  ok(
    targets.length === 5 && targets[0] === "c1" && !targets.includes("c6"),
    "G2-语义: 客户目标推导跨来源去重且 cap=5",
    targets,
  );
}

// ══ #89 黄金模板依赖声明补全 ══
{
  const golden = buildSalesFollowupGoldenPlan();
  const s5 = golden.steps.find((s) => s.id === "s5_prioritize");
  ok(
    JSON.stringify(s5?.dependsOn) ===
      JSON.stringify([
        "s2_opportunities",
        "s3_followup_analysis",
        "s4_quote_risk",
      ]),
    "G3-模板: s5 依赖声明补全（声明=真实消费集）",
  );
  const sanitized = sanitizePlannerOutput(
    golden,
    plannerVisibleRuntimeV2Tools(),
    8,
  );
  ok(
    sanitized.ok &&
      sanitized.plan.steps.every(
        (s) => !s.preferredTool || isRuntimeV2ToolExecutable(s.preferredTool),
      ),
    "G1/G3: 黄金计划全部工具经 planner 投影仍合法且可执行",
  );
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
