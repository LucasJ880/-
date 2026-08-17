/**
 * Tender T1B — 纯逻辑不变量测试（无 DB）
 *
 * 覆盖任务书：§12（MINIMUM TOOL SCOPE：白名单成员资格与全局目录零污染）、
 * §15（scope 解析 fail-safe）、§21（澄清仅草稿）、§23（结果契约）、
 * §28（工具零审批动作声明）、§30/§38 T1B-15（生产并行默认 1，tender
 * 工具永不 SAFE_PARALLEL）、§31（feature flag 默认关）、§7（legacy 队列
 * 状态词汇隔离）、T1B-02 路由授权源码契约。
 *
 * 运行：npx tsx <本文件>（不需要 DATABASE_URL）
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ok, finish } from "@/lib/workforce-runtime/__tests__/helpers";
import {
  isTenderWorkforceAnalysisEnabledWithEnv,
} from "../flags";
import {
  TENDER_ANALYSIS_RESULT_VERSION,
  parseTenderAnalysisResultV1,
} from "../result-contract";
import {
  TENDER_WORKFORCE_TOOL_DESCRIPTORS,
  TENDER_WORKFORCE_TOOL_HANDLERS,
  TENDER_WORKFORCE_TOOL_NAMES,
  tenderWorkforcePlannerTools,
  tenderWorkforceDeterministicTools,
  TENDER_WORKFORCE_PLANNER_TOOL_NAMES,
  TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES,
} from "../tools";
import {
  buildTenderAnalysisGoal,
  TENDER_JOB_BLOCKING_STATUSES,
} from "../trigger-service";
import {
  buildWorkforceTenderIdempotencyKey,
  TENDER_AGENT_RUN_STATUS,
} from "../analysis-run-service";
import { resolveWorkforcePlannerToolsForJob } from "@/lib/workforce-runtime/scope";
import {
  RUNTIME_V2_TOOL_CATALOG,
  plannerVisibleRuntimeV2Tools,
} from "@/lib/agent-runtime-v2/tool-catalog";
import { isRuntimeV2ToolExecutable } from "@/lib/agent-runtime-v2/adapters";
import { classifyTaskExecutionPolicy } from "@/lib/workforce-runtime/parallel";
import { getWorkforceMaxParallelTasksWithEnv } from "@/lib/workforce-runtime/parallel";
import { CLAIMABLE_STATUSES, TERMINAL_STATUSES } from "@/lib/tender-auto-analysis/constants";
import { WORKFORCE_TASK_CONTRACT_VERSION } from "@/lib/workforce-runtime/task-contract";

async function main(): Promise<void> {
console.log("Tender T1B — 纯逻辑不变量测试\n");

/* ── §31 Feature flag ── */
console.log("[§31 Feature Flag]");
ok(
  isTenderWorkforceAnalysisEnabledWithEnv({ orgId: "o1" }, {}) === false,
  "flag: 默认（env 未设）关闭（production 安全默认）",
);
ok(
  isTenderWorkforceAnalysisEnabledWithEnv(
    { orgId: "o1" },
    { TENDER_WORKFORCE_ANALYSIS_ENABLED: "1" },
  ) === true,
  "flag: master=1 且无 allowlist → 开启",
);
ok(
  isTenderWorkforceAnalysisEnabledWithEnv(
    { orgId: "o1" },
    {
      TENDER_WORKFORCE_ANALYSIS_ENABLED: "1",
      TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST: "o2,o3",
    },
  ) === false,
  "flag: org allowlist 非空且未命中 → 拒绝",
);
ok(
  isTenderWorkforceAnalysisEnabledWithEnv(
    { orgId: "o2" },
    {
      TENDER_WORKFORCE_ANALYSIS_ENABLED: "1",
      TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST: "o2",
    },
  ) === true,
  "flag: org allowlist 命中 → 开启",
);

/* ── §12 工具白名单与全局目录零污染 ── */
console.log("\n[§12 Tool Scope]");
// Segment 3：三层工具面。可执行 9；LLM 兼容面 7（旧 T1B 回滚语义，
// 既无 canonical V2 也无 grounded 交付物）；确定性 V2 面 8（无 legacy extract）。
ok(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.length === 9 &&
    TENDER_WORKFORCE_TOOL_NAMES.length === 9 &&
    TENDER_WORKFORCE_PLANNER_TOOL_NAMES.length === 7 &&
    TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES.length === 8,
  "scope: 可执行 9 / LLM 兼容 7 / 确定性 V2 8",
  {
    exec: TENDER_WORKFORCE_TOOL_NAMES.length,
    llm: TENDER_WORKFORCE_PLANNER_TOOL_NAMES.length,
    det: TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES.length,
  },
);
ok(
  !tenderWorkforcePlannerTools().some(
    (t) =>
      t.name === "tender_analyze_package_v2" ||
      t.name === "tender_build_deliverables",
  ),
  "scope/§2B: LLM 兼容面既无 canonical V2 工具也无 grounded 交付物工具",
);
ok(
  tenderWorkforceDeterministicTools().some(
    (t) => t.name === "tender_analyze_package_v2",
  ) &&
    !tenderWorkforceDeterministicTools().some(
      (t) => t.name === "tender_extract_requirements",
    ),
  "scope/§2C: 确定性 V2 面含 canonical V2 工具、不含 legacy 抽取",
);
ok(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.every(
    (d) => d.requiresApproval === false,
  ),
  "scope/§28: 全部工具 requiresApproval=false（只产机器分析产物，无业务承诺动作）",
);
ok(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.every(
    (d) => (d as { parallelSafe?: boolean }).parallelSafe === undefined,
  ),
  "scope/§30: 全部工具不标 parallelSafe（classifier 恒 SEQUENTIAL，顺序基线）",
);
ok(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.every((d) =>
    isRuntimeV2ToolExecutable(d.name),
  ),
  "scope/#88: 白名单 ⊆ EXECUTABLE（每个工具都有真实 server handler）",
);
ok(
  Object.keys(TENDER_WORKFORCE_TOOL_HANDLERS).length === 9 &&
    TENDER_WORKFORCE_TOOL_NAMES.every(
      (n) => typeof TENDER_WORKFORCE_TOOL_HANDLERS[n] === "function",
    ),
  "scope: handler 注册表与白名单一一对应",
);
ok(
  RUNTIME_V2_TOOL_CATALOG.length === 13 &&
    RUNTIME_V2_TOOL_CATALOG.every((t) => !t.name.startsWith("tender_")),
  "scope/#94: 全局 catalog 保持 13 个销售线工具，零 tender 污染",
);
ok(
  plannerVisibleRuntimeV2Tools().every((t) => !t.name.startsWith("tender_")),
  "scope/#88: 全局 planner 可见投影不含任何 tender 工具（legacy/sales 计划面零暴露）",
);
ok(
  tenderWorkforcePlannerTools().every((t) =>
    (TENDER_WORKFORCE_TOOL_NAMES as readonly string[]).includes(t.name),
  ),
  "scope: planner 白名单投影 ⊆ tender 工具集",
);

/* ── §15 scope 解析 fail-safe ── */
console.log("\n[§15 Scope Resolution]");
{
  const tender = await resolveWorkforcePlannerToolsForJob({
    workDomain: "tender",
  });
  ok(
    Array.isArray(tender) && tender.length === 7,
    "resolve: workDomain=tender → 7 个 LLM 兼容工具白名单（planner 投影）",
  );
  const none = await resolveWorkforcePlannerToolsForJob({});
  ok(none === undefined, "resolve: 无 workDomain → undefined（既有默认投影，行为不变）");
  const unknown = await resolveWorkforcePlannerToolsForJob({
    workDomain: "sales",
  });
  ok(unknown === undefined, "resolve: 未注册域 → undefined（fail-safe）");
  const nil = await resolveWorkforcePlannerToolsForJob(null);
  ok(nil === undefined, "resolve: metadata=null → undefined");
}

/* ── §30 生产并行默认 + tender 工具永不 SAFE_PARALLEL ── */
console.log("\n[§30 / T1B-15 Sequential Baseline]");
ok(
  getWorkforceMaxParallelTasksWithEnv({}) === 1,
  "parallel: 生产默认（env 未设）= 1",
);
{
  const step = {
    stepKey: "t2",
    executionMode: "analysis",
    riskLevel: "MEDIUM",
    requiresApproval: false,
    preferredTool: "tender_extract_requirements",
    inputJson: {
      workforceTask: {
        contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
        worker: { workerKey: "tender_worker", role: "tender_specialist" },
        taskKind: "work",
        objective: "提取要求",
      },
    },
  };
  const policy = classifyTaskExecutionPolicy(step);
  ok(
    policy !== "SAFE_PARALLEL",
    `parallel: tender 工具不入 SAFE_PARALLEL（无 catalog descriptor → ${policy}）`,
  );
}

/* ── §7 legacy 队列状态词汇隔离 ── */
console.log("\n[§7 Legacy Queue Isolation]");
ok(
  !(CLAIMABLE_STATUSES as readonly string[]).includes(
    TENDER_AGENT_RUN_STATUS.running,
  ) &&
    !(CLAIMABLE_STATUSES as readonly string[]).includes(
      TENDER_AGENT_RUN_STATUS.failed,
    ),
  "isolation: AGENT_ANALYZING / AGENT_FAILED ∉ legacy CLAIMABLE_STATUSES",
);
ok(
  !(TERMINAL_STATUSES as readonly string[]).includes(
    TENDER_AGENT_RUN_STATUS.running,
  ),
  "isolation: AGENT_ANALYZING 不是 legacy 终态（不影响 supersede 语义）",
);
{
  // legacy worker 的 reaper / 候选查询字面量：确保不覆盖 AGENT_* 状态
  const workerSource = readFileSync(
    join(process.cwd(), "src/lib/tender-auto-analysis/worker.ts"),
    "utf8",
  );
  ok(
    !workerSource.includes("AGENT_ANALYZING") &&
      !workerSource.includes("AGENT_FAILED"),
    "isolation: legacy worker 源码不涉及 AGENT_* 状态（零认领/零回收路径）",
  );
}
ok(
  TENDER_AGENT_RUN_STATUS.reviewRequired === "REVIEW_REQUIRED",
  "isolation: 成功终态复用 REVIEW_REQUIRED（审阅/approve 流程原样）",
);

/* ── §10 幂等键与活跃状态集 ── */
console.log("\n[§10 Idempotency]");
ok(
  buildWorkforceTenderIdempotencyKey("job_1") === "tender-workforce:v1:job_1" &&
    buildWorkforceTenderIdempotencyKey("job_1") ===
      buildWorkforceTenderIdempotencyKey("job_1"),
  "idempotency: 域 run 幂等键 = 每 Job 稳定唯一",
);
ok(
  (
    [
      "queued",
      "planning",
      "running",
      "executing",
      "verifying",
      "repairing",
      "awaiting_approval",
      "needs_human",
    ] as const
  ).every((s) =>
    (TENDER_JOB_BLOCKING_STATUSES as readonly string[]).includes(s),
  ),
  "idempotency: 活跃阻断集覆盖全部进行中/等人状态（含 needs_human）",
);
ok(
  !(TENDER_JOB_BLOCKING_STATUSES as readonly string[]).includes("completed") &&
    !(TENDER_JOB_BLOCKING_STATUSES as readonly string[]).includes("failed") &&
    !(TENDER_JOB_BLOCKING_STATUSES as readonly string[]).includes("cancelled"),
  "idempotency: 历史终态不阻断重新分析（§10）",
);

/* ── §23 结果契约 ── */
console.log("\n[§23 Result Contract]");
{
  const valid = {
    contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
    projectSummary: "测试综合结论",
    readiness: "GAPS_FOUND",
    requirementsSummary: {
      total: 5,
      mandatory: 3,
      evidenceRequired: 2,
      sourceLinked: 4,
    },
    missingInformation: ["缺少技术规格书"],
    criticalRisks: [
      {
        severity: "CRITICAL",
        kind: "MANDATORY_REQUIREMENT_MISSING",
        statement: "M1 保证金要求缺少来源支撑",
        source: "M1",
      },
    ],
    importantRisks: [],
    clarifications: [
      {
        question: "保修年限是否含电机？",
        reason: "文档未明确",
        priority: "HIGH",
        whyOwnerNeedsToAnswer: "影响报价成本",
      },
    ],
    submissionRisks: [],
    recommendedNextActions: ["人工审阅"],
    sourceCoverage: {
      documentCount: 2,
      parsedPageCount: 10,
      factCount: 6,
      sourceRefCount: 8,
    },
    analysisLimitations: ["以当前文件包为准"],
    hiddenChainOfThought: "绝不应保留的字段",
  };
  const parsed = parseTenderAnalysisResultV1(valid);
  ok(parsed.ok, "contract: 合法结果通过校验");
  ok(
    parsed.ok &&
      !("hiddenChainOfThought" in (parsed.result as Record<string, unknown>)),
    "contract/§23: 未知字段被 strip（不承载 hidden reasoning / prompt / tool internals）",
  );
  const invalid = parseTenderAnalysisResultV1({
    contractVersion: "tender-analysis-result/v2",
  });
  ok(!invalid.ok, "contract: 版本/结构不符 → fail-closed");
}

/* ── §21 澄清仅草稿（结构断言） ── */
console.log("\n[§21 Clarification Draft-Only]");
{
  const toolsSource = readFileSync(
    join(process.cwd(), "src/lib/tender-workforce/tools.ts"),
    "utf8",
  );
  ok(
    !/sendEmail|gmail|sendClarification|smtp/i.test(toolsSource),
    "clarification: tender 工具层零发送能力（draft-only）",
  );
}

/* ── §8 goal 构造 ── */
console.log("\n[§8 Goal]");
{
  const goal = buildTenderAnalysisGoal("测试项目");
  ok(
    goal.includes("不超过 8 个任务") &&
      goal.includes("synthesis") &&
      goal.includes("tender_finalize_analysis"),
    "goal: 含步数上限 / synthesis / finalize 约束（兼容路径 8 步，不含交付物）",
  );
  ok(goal.length < 600, "goal: 长度有界");
}

/* ── T1B-02 路由授权源码契约 ── */
console.log("\n[T1B-02 Route Authz Contract]");
{
  const routeSource = readFileSync(
    join(
      process.cwd(),
      "src/app/api/projects/[id]/tender-analysis/agent/route.ts",
    ),
    "utf8",
  );
  ok(
    routeSource.includes("requireTenderAnalysisRead") &&
      routeSource.includes("requireTenderAnalysisWrite"),
    "route: GET 用项目读门、POST 用项目写门（#95 同源 requireProject*Access）",
  );
  ok(
    !routeSource.includes('from "@/lib/db"'),
    "route: 不直连 db（业务经 trigger-service）",
  );
  ok(
    routeSource.indexOf("requireTenderAnalysisWrite") >
      routeSource.indexOf("requireTenderAnalysisRead"),
    "route: 读写门分离（GET read / POST write）",
  );
}

finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
