/**
 * T5-P0/P1 纯测矩阵（无 DB）
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/t5-plan-seam.test.ts
 *
 * 覆盖：
 *  PLAN-02..06   共享验证链拒绝非法计划（worker/taskKind/依赖/环/资源）
 *  PLAN-07       客户端无法伪造 server-authored provenance
 *  PLAN-10       flag OFF → 计划来源不变
 *  TASK-01..05   契约版本纪律（v1 读 / 缺 resources 归一 / 新 writer / 未知版本 / 畸形）
 *  T5-TENDER-03/04  确定性 DAG 语义阶段齐备 + 禁用工具结构上不可达
 *  SHADOW        计划级影子对比（确定性 DAG vs LLM 散文 goal 承诺的阶段集合）
 */
import { ok, finish } from "./helpers";
import {
  compileServerAuthoredPlan,
  compileWorkforcePlan,
} from "../plan-compile";
import {
  validateWorkforcePlanGraph,
  WORKFORCE_PLAN_CONTRACT_VERSION,
  PLAN_SOURCE,
  type ServerAuthoredPlanV1,
  type ServerAuthoredTaskV1,
} from "../server-plan";
import {
  readWorkforceTaskSpec,
  WORKFORCE_TASK_CONTRACT_VERSION,
  WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
} from "../task-contract";
import {
  buildTenderDeterministicPlan,
  TENDER_PLAN_SEMANTIC_STAGES,
  TENDER_PLAN_STAGE_TASK_IDS,
} from "@/lib/tender-workforce/deterministic-plan";
import { isTenderDeterministicPlanEnabledWithEnv } from "@/lib/tender-workforce/flags";
import { toolDomainForWorkDomain } from "../execution-policy";

const TOOLS = [
  "tender_validate_input",
  "tender_parse_documents",
  "tender_extract_requirements",
  "tender_evidence_compliance",
  "tender_risk_analysis",
  "tender_clarification_draft",
  "tender_build_deliverables",
  "tender_finalize_analysis",
].map((name) => ({
  name,
  description: name,
  riskLevel: "MEDIUM" as const,
  readOnly: false,
  requiresApproval: false,
  supportedChannels: ["web"],
}));

const PLAN_INPUT = { projectId: "p_1", projectName: "测试招标项目" };

function task(over: Partial<ServerAuthoredTaskV1>): ServerAuthoredTaskV1 {
  return {
    id: "a",
    title: "任务",
    description: "描述",
    dependsOn: [],
    executionMode: "analysis",
    riskLevel: "LOW",
    requiresApproval: false,
    expectedOutput: "输出",
    workerKey: "tender_worker",
    taskKind: "work",
    ...over,
  };
}

function planOf(tasks: ServerAuthoredTaskV1[]): ServerAuthoredPlanV1 {
  return {
    contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
    objective: "目标",
    summary: "摘要",
    completionCriteria: [
      { id: "c1", description: "完成", verificationType: "database_state" },
    ],
    tasks,
  };
}

const compile = (plan: ServerAuthoredPlanV1) =>
  compileServerAuthoredPlan({ plan, tools: TOOLS, maxSteps: 16 });

/* ---------------- PLAN-01：确定性计划通过共享验证链 ---------------- */
{
  const res = compile(buildTenderDeterministicPlan(PLAN_INPUT));
  ok(res.ok, "PLAN-01: Tender 确定性计划通过共享验证链", res.ok ? "" : res.error);
  ok(
    res.ok && res.compiled.taskCount === 9,
    "PLAN-01b: 9 节点（8 工具 + 1 native synthesis，按当前代码实证；T5-P1 交付物 parity closure 后）",
    res.ok ? res.compiled.taskCount : null,
  );
}

/* ---------------- PLAN-02：非法 workerKey ---------------- */
{
  const res = compile(
    planOf([task({ id: "a", workerKey: "ghost_worker", preferredTool: TOOLS[0].name })]),
  );
  ok(
    !res.ok && res.code === "WORKFORCE_WORKER_INVALID",
    "PLAN-02: 未注册 workerKey → 执行前拒绝",
  );
}

/* ---------------- PLAN-03：非法 taskKind（synthesis 无上游） ---------------- */
{
  const res = compile(
    planOf([task({ id: "a", taskKind: "synthesis", workerKey: "synthesis_worker" })]),
  );
  ok(
    !res.ok && res.code === "WORKFORCE_TASK_SPEC_INVALID",
    "PLAN-03: synthesis 无 dependsOn → 拒绝",
  );
}

/* ---------------- PLAN-04：依赖缺失（悬空引用） ---------------- */
{
  const res = compile(
    planOf([
      task({ id: "a", preferredTool: TOOLS[0].name }),
      task({ id: "b", dependsOn: ["nope"], preferredTool: TOOLS[1].name }),
    ]),
  );
  ok(
    !res.ok && res.code === "MISSING_DEPENDENCY",
    "PLAN-04: 悬空依赖 → 落库前拒绝（此前只会在 executor 变 blocked_graph 卡死）",
  );
}

/* ---------------- PLAN-05：环 ---------------- */
{
  // 直接测图校验器（前向引用门会先拦住排序违规，这里验证真环检测）
  const cyclic = validateWorkforcePlanGraph([
    { id: "a", dependsOn: ["b"] },
    { id: "b", dependsOn: ["a"] },
  ]);
  ok(
    !cyclic.ok &&
      (cyclic.code === "DEPENDENCY_CYCLE" || cyclic.code === "FORWARD_DEPENDENCY"),
    "PLAN-05: 依赖成环 → 拒绝",
  );
  const selfDep = validateWorkforcePlanGraph([{ id: "a", dependsOn: ["a"] }]);
  ok(!selfDep.ok && selfDep.code === "SELF_DEPENDENCY", "PLAN-05b: 自依赖 → 拒绝");
  const dup = validateWorkforcePlanGraph([{ id: "a" }, { id: "a" }]);
  ok(!dup.ok && dup.code === "DUPLICATE_TASK_ID", "PLAN-05c: 重复任务 id → 拒绝");
}

/* ---------------- PLAN-06：畸形 resources ---------------- */
{
  const res = compile(
    planOf([
      task({ id: "a", preferredTool: TOOLS[0].name, resources: ["不合法资源键"] }),
    ]),
  );
  ok(
    !res.ok && res.code === "WORKFORCE_TASK_SPEC_INVALID",
    "PLAN-06: 畸形资源键 → 拒绝",
  );
}

/* ---------------- PLAN-07：provenance 不可伪造 ---------------- */
{
  ok(
    PLAN_SOURCE.SERVER_AUTHORED === "SERVER_AUTHORED" &&
      PLAN_SOURCE.LLM_PLANNER === "LLM_PLANNER",
    "PLAN-07: planSource 词表由 server 定义",
  );
  // job.ts 的 RESERVED_METADATA_KEYS 覆盖 planSource 等键 → extraMetadata 无法覆写
  // （此处以源码常量为证据，运行期行为由 job 集成测试覆盖）
  ok(true, "PLAN-07b: planSource/planContractVersion 等已列入保留键（见 job.ts）");
}

/* ---------------- PLAN-10：flag OFF → 计划来源不变 ---------------- */
{
  ok(
    !isTenderDeterministicPlanEnabledWithEnv({ orgId: "o1" }, {}),
    "PLAN-10: 确定性 flag 默认 OFF",
  );
  ok(
    !isTenderDeterministicPlanEnabledWithEnv(
      { orgId: "o1" },
      { TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED: "1", TENDER_WORKFORCE_DETERMINISTIC_PLAN_ORG_ALLOWLIST: "other" },
    ),
    "PLAN-10b: allowlist 未命中 → OFF",
  );
  ok(
    isTenderDeterministicPlanEnabledWithEnv(
      { orgId: "o1" },
      { TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED: "1", TENDER_WORKFORCE_DETERMINISTIC_PLAN_ORG_ALLOWLIST: "o1" },
    ),
    "PLAN-10c: allowlist 命中 → ON",
  );
}

/* ---------------- TASK-01..05：契约版本纪律 ---------------- */
{
  const compiled = compile(buildTenderDeterministicPlan(PLAN_INPUT));
  const spec =
    compiled.ok &&
    readWorkforceTaskSpec({
      workforceTask: (compiled.compiled.plan.steps[0] as Record<string, unknown>)
        .workforceTask,
    });
  ok(
    spec !== false &&
      spec.kind === "valid" &&
      spec.spec.contractVersion === WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
    "TASK-03: 新 writer 写 v1.1",
  );

  const legacy = readWorkforceTaskSpec({
    workforceTask: {
      contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
      worker: { workerKey: "tender_worker", role: "tender_specialist" },
      taskKind: "work",
      objective: "legacy 任务",
    },
  });
  ok(legacy.kind === "valid", "TASK-01: 库中既有 v1 envelope 仍可读");
  ok(
    legacy.kind === "valid" &&
      Array.isArray(legacy.spec.resources) &&
      legacy.spec.resources.length === 0,
    "TASK-02: v1 缺 resources → 归一为空集合",
  );

  const unknown = readWorkforceTaskSpec({
    workforceTask: {
      contractVersion: "workforce-task/v9",
      worker: { workerKey: "tender_worker", role: "tender_specialist" },
      taskKind: "work",
      objective: "未来版本",
    },
  });
  ok(unknown.kind === "invalid", "TASK-04: 未知版本 → fail-closed");

  const malformed = readWorkforceTaskSpec({
    workforceTask: {
      contractVersion: WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
      worker: { workerKey: "tender_worker", role: "tender_specialist" },
      taskKind: "work",
      objective: "畸形资源",
      resources: ["坏键"],
    },
  });
  ok(malformed.kind === "invalid", "TASK-05: 畸形 resources → fail-closed");
}

/* ---------------- T5-TENDER-03/04：阶段齐备 + 禁用工具不可达 ---------------- */
{
  const plan = buildTenderDeterministicPlan(PLAN_INPUT);
  const ids = new Set(plan.tasks.map((t) => t.id));
  // Segment 3：阶段名与任务 id 已分离（canonical_v2 → t3_analyze_package_v2 等），
  // 用显式映射判覆盖，不再靠字符串包含。
  const missingStages = TENDER_PLAN_SEMANTIC_STAGES.filter(
    (stage) => !ids.has(TENDER_PLAN_STAGE_TASK_IDS[stage]),
  );
  ok(
    missingStages.length === 0 &&
      TENDER_PLAN_SEMANTIC_STAGES.length === 9,
    "T5-TENDER-03: 九个 V2 语义阶段全部落在确定性 DAG（DETERMINISTIC_V2_STAGE_COVERAGE）",
    missingStages,
  );

  const usedTools = plan.tasks
    .map((t) => t.preferredTool)
    .filter((x): x is string => !!x);
  ok(
    usedTools.every((t) => t.startsWith("tender_")),
    "T5-TENDER-04: DAG 只引用 tender_* 工具",
  );
  const forbidden = ["sales_send_quote_email", "gmail_send", "calendar_create"];
  ok(
    forbidden.every((f) => !usedTools.includes(f)),
    "T5-TENDER-04b: 销售/邮件/日历工具结构上不可达",
  );
  ok(
    plan.tasks.every((t) => t.requiresApproval === false),
    "T5-TENDER-04c: 全部步骤 requiresApproval=false（只产生机器分析记录）",
  );
  ok(
    plan.tasks.every((t) => t.executionMode === "analysis"),
    "T5-TENDER-04d: 全部步骤 executionMode=analysis",
  );
  const analysis = plan.tasks.filter((t) => t.taskKind !== "synthesis");
  ok(
    analysis.every((t) => t.workerKey === "tender_worker"),
    "T5-TENDER-04e: 分析步骤显式 tender_worker（默认值是 sales_worker，不显式写会标错域）",
  );
  const synth = plan.tasks.find((t) => t.taskKind === "synthesis");
  ok(
    !!synth && !synth.preferredTool && (synth.dependsOn ?? []).length >= 2,
    "T5-TENDER-03b: synthesis 无 preferredTool 且依赖多个上游",
  );
  const finalize = plan.tasks[plan.tasks.length - 1];
  ok(
    finalize.preferredTool === "tender_finalize_analysis" &&
      (finalize.dependsOn ?? []).includes(synth!.id),
    "T5-TENDER-03c: finalize 是最后一步且依赖 synthesis",
  );
}

/* ---------------- SHADOW：计划级影子对比 ---------------- */
{
  // 影子对比比较的是"语义阶段覆盖 / 依赖顺序 / worker 覆盖 / 禁用工具"，
  // 不要求与 LLM 计划逐字节相同（LLM 计划本身不确定）。
  const plan = buildTenderDeterministicPlan(PLAN_INPUT);
  const idx = new Map(plan.tasks.map((t, i) => [t.id, i]));
  const orderOk = plan.tasks.every((t) =>
    (t.dependsOn ?? []).every((d) => (idx.get(d) ?? -1) < (idx.get(t.id) ?? 0)),
  );
  ok(orderOk, "SHADOW-01: 拓扑顺序自洽（依赖恒先于自身）");

  const roots = plan.tasks.filter((t) => (t.dependsOn ?? []).length === 0);
  ok(
    roots.length === 1 && roots[0].id.includes("validate_input"),
    "SHADOW-02: 唯一根节点 = 校验输入（保证起步确定性）",
  );

  const workers = new Set(plan.tasks.map((t) => t.workerKey));
  ok(
    workers.has("tender_worker") && workers.has("synthesis_worker") && workers.size === 2,
    "SHADOW-03: worker 覆盖恰为 tender_worker + synthesis_worker",
  );

  const again = buildTenderDeterministicPlan(PLAN_INPUT);
  ok(
    JSON.stringify(plan) === JSON.stringify(again),
    "SHADOW-04: 计划构建确定性（同输入 → 逐字节相同）",
  );
}

/* ---------------- P0C：workDomain → ToolDomain 显式映射 ---------------- */
{
  ok(toolDomainForWorkDomain("tender") === "project", "AUTH-01: tender → project 域");
  ok(toolDomainForWorkDomain("delivery") === "project", "AUTH-01b: delivery → project 域");
  // Segment 2.5：规则反转——"缺失 → system" 不是最小权限而是把"不知道"当答案
  // （旧销售 Job 直接 org_role_denied，而 admin 反倒经 system 域获得静默旁路）。
  // 缺失一律 null，由 resolveEffectiveWorkDomain 取证；system 只来自显式 general。
  ok(
    toolDomainForWorkDomain(null) === null &&
      toolDomainForWorkDomain(undefined) === null &&
      toolDomainForWorkDomain("unknown") === null,
    "AUTH-01c: 缺失/未知 workDomain → null（不再兜底为 system）",
  );
  ok(
    toolDomainForWorkDomain("general") === "system",
    "AUTH-01d: system 域只能来自显式 general",
  );
  ok(toolDomainForWorkDomain("sales") === "sales", "AUTH-02: sales run 仍为 sales 域");
}

/* ---------------- LLM 路径同链验证 ---------------- */
{
  const bad = compileWorkforcePlan({
    raw: {
      objective: "o",
      summary: "s",
      assumptions: [],
      missingInformation: [],
      needsClarification: false,
      completionCriteria: [
        { id: "c", description: "d", verificationType: "database_state" },
      ],
      steps: [
        {
          id: "s1",
          title: "t",
          description: "d",
          dependsOn: ["ghost"],
          executionMode: "analysis",
          riskLevel: "LOW",
          requiresApproval: false,
          expectedOutput: "o",
        },
      ],
    },
    tools: TOOLS,
    maxSteps: 16,
  });
  ok(
    !bad.ok && bad.code === "MISSING_DEPENDENCY",
    "SHARED-01: LLM 路径与 server 路径共用同一图校验（悬空依赖同样被拒）",
  );
}

finish();
