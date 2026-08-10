/**
 * Phase 2B-2 — Parallel Policy / Batch 纯函数测试（无 DB）
 *
 * 覆盖任务书：§6（classifier server-owned）、§7（SAFE_PARALLEL 全条件）、
 * §8（REQUIRES_APPROVAL 分类）、§9（EXCLUSIVE_RESOURCE 冲突）、§10（资源
 * 声明 backward-compatible + fail-closed 消毒）、§11（并行上限 clamp）、
 * §14（bounded batch 组装：审批单独成批 / SAFE 收集 / 资源不相交）。
 *
 * 运行：npx tsx <本文件>（不需要 DATABASE_URL）
 */

import { ok, finish } from "./helpers";
import {
  classifyTaskExecutionPolicy,
  buildParallelBatch,
  collectOccupiedResourceKeys,
  readTaskResources,
  getWorkforceMaxParallelTasksWithEnv,
  WORKFORCE_JOB_MAX_PARALLEL_TASKS_DEFAULT,
  WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX,
  type TaskPolicyStepInput,
} from "../parallel";
import {
  applyWorkforceTaskSpecs,
  readWorkforceTaskSpec,
  WORKFORCE_TASK_CONTRACT_VERSION,
  WorkforceTaskSpecV1Schema,
} from "../task-contract";
import type { PlannerOutput } from "@/lib/agent-runtime-v2/schemas";

type AnyRecord = Record<string, unknown>;

/** 合法 workforce-task/v1 spec（server 形态） */
function specJson(extra: AnyRecord = {}): AnyRecord {
  return {
    workforceTask: {
      contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
      worker: { workerKey: "sales_worker", role: "sales_specialist" },
      taskKind: "work",
      objective: "测试任务",
      ...extra,
    },
  };
}

function stepOf(over: Partial<TaskPolicyStepInput> = {}): TaskPolicyStepInput {
  return {
    stepKey: over.stepKey ?? "t",
    executionMode: "read",
    riskLevel: "LOW",
    requiresApproval: false,
    preferredTool: "sales_get_pipeline",
    inputJson: specJson(),
    ...over,
  };
}

function planOf(steps: Array<AnyRecord>): PlannerOutput {
  return {
    objective: "Phase 2B-2 策略测试计划",
    summary: "Phase 2B-2 策略测试计划",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
    ],
    steps,
  } as unknown as PlannerOutput;
}

function readStep(id: string, extra: AnyRecord = {}): AnyRecord {
  return {
    id,
    title: `步骤 ${id}`,
    description: `执行 ${id}`,
    dependsOn: [],
    preferredTool: "sales_get_pipeline",
    executionMode: "read",
    riskLevel: "LOW",
    requiresApproval: false,
    expectedOutput: `${id} 产出`,
    ...extra,
  };
}

console.log("Phase 2B-2 — Parallel Policy / Batch 纯函数测试");

// ══ §6/§7 SAFE_PARALLEL 全条件 ══
console.log("\n[§7 SAFE_PARALLEL 判定]");
ok(
  classifyTaskExecutionPolicy(stepOf()) === "SAFE_PARALLEL",
  "P: read + LOW + 无审批 + catalog parallelSafe + 无资源冲突 → SAFE_PARALLEL",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ executionMode: "analysis", preferredTool: "sales_quote_risk_analysis" }),
  ) === "SAFE_PARALLEL",
  "P: analysis + 分析工具 → SAFE_PARALLEL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ riskLevel: "MEDIUM" })) ===
    "SAFE_PARALLEL",
  "P: riskLevel MEDIUM 允许 SAFE_PARALLEL",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ inputJson: specJson({ resources: ["quote:q1"] }) }),
  ) === "SAFE_PARALLEL",
  "P/§28: 声明了资源但无冲突 → 仍是 SAFE_PARALLEL",
);

// ══ §8 REQUIRES_APPROVAL ══
console.log("\n[§8 REQUIRES_APPROVAL 判定]");
ok(
  classifyTaskExecutionPolicy(stepOf({ requiresApproval: true })) ===
    "REQUIRES_APPROVAL",
  "P: requiresApproval=true → REQUIRES_APPROVAL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ executionMode: "write" })) ===
    "REQUIRES_APPROVAL",
  "P: executionMode=write → REQUIRES_APPROVAL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ executionMode: "approval" })) ===
    "REQUIRES_APPROVAL",
  "P: executionMode=approval → REQUIRES_APPROVAL",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ preferredTool: "gmail_create_draft" }),
  ) === "REQUIRES_APPROVAL",
  "P: planner 谎称 read，server catalog 判定写工具 → REQUIRES_APPROVAL（server-owned）",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ preferredTool: "sales_update_followup" }),
  ) === "REQUIRES_APPROVAL",
  "P: 修改业务对象工具 → REQUIRES_APPROVAL",
);

// ══ fail-safe → SEQUENTIAL ══
console.log("\n[§7 fail-safe → SEQUENTIAL]");
ok(
  classifyTaskExecutionPolicy(stepOf({ inputJson: null })) === "SEQUENTIAL",
  "P: 无 workforce spec（legacy Step）→ SEQUENTIAL（不确定即串行）",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ inputJson: { workforceTask: { contractVersion: "workforce-task/v999" } } }),
  ) === "SEQUENTIAL",
  "P: spec 损坏 → SEQUENTIAL（执行层另有 fail-closed gate）",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ riskLevel: "HIGH" })) === "SEQUENTIAL",
  "P: riskLevel HIGH → SEQUENTIAL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ riskLevel: "CRITICAL" })) ===
    "SEQUENTIAL",
  "P: riskLevel CRITICAL → SEQUENTIAL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ preferredTool: null })) === "SEQUENTIAL",
  "P: 无 preferredTool → SEQUENTIAL",
);
ok(
  classifyTaskExecutionPolicy(stepOf({ preferredTool: "unknown_tool_x" })) ===
    "SEQUENTIAL",
  "P: 工具不在 server catalog → SEQUENTIAL（fail-safe）",
);

// ══ §9 EXCLUSIVE_RESOURCE ══
console.log("\n[§9 EXCLUSIVE_RESOURCE 判定]");
const occupied = new Set(["quote:q123"]);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ inputJson: specJson({ resources: ["quote:q123"] }) }),
    { occupiedResourceKeys: occupied },
  ) === "EXCLUSIVE_RESOURCE",
  "P: 资源与占用集相交 → EXCLUSIVE_RESOURCE",
);
ok(
  classifyTaskExecutionPolicy(
    stepOf({ inputJson: specJson({ resources: ["quote:q456"] }) }),
    { occupiedResourceKeys: occupied },
  ) === "SAFE_PARALLEL",
  "P: 资源不相交 → SAFE_PARALLEL",
);
ok(
  readTaskResources(specJson({ resources: ["quote:q1", "tender:t1"] })).join(",") ===
    "quote:q1,tender:t1",
  "P: readTaskResources 读取 server 校验后的声明",
);
ok(
  readTaskResources({ workforceTask: { bad: true } }).length === 0 &&
    readTaskResources(null).length === 0,
  "P: spec absent/invalid → 无资源声明（策略层由 SEQUENTIAL 兜底）",
);
{
  const occ = collectOccupiedResourceKeys([
    { status: "running", inputJson: specJson({ resources: ["quote:q1"] }) },
    { status: "awaiting_approval", inputJson: specJson({ resources: ["tender:t9"] }) },
    { status: "completed", inputJson: specJson({ resources: ["quote:q2"] }) },
    { status: "ready", inputJson: specJson({ resources: ["quote:q3"] }) },
  ]);
  ok(
    occ.has("quote:q1") && occ.has("tender:t9") && !occ.has("quote:q2") && !occ.has("quote:q3"),
    "P: 占用集 = running ∪ awaiting_approval（审批窗口占用资源键）",
  );
}

// ══ §10 资源声明 server 消毒（fail-closed）══
console.log("\n[§10 资源声明消毒]");
{
  const adapted = applyWorkforceTaskSpecs(
    planOf([readStep("t1", { resources: ["quote:q123", " quote:q123 ", "tender:t1"] })]),
  );
  const spec =
    adapted.ok &&
    readWorkforceTaskSpec(
      { workforceTask: (adapted.plan.steps[0] as AnyRecord).workforceTask },
    );
  ok(
    adapted.ok &&
      spec !== false &&
      spec.kind === "valid" &&
      JSON.stringify(spec.spec.resources) === JSON.stringify(["quote:q123", "tender:t1"]),
    "P: 合法资源声明 trim + 去重后落 spec.resources",
    adapted.ok ? undefined : adapted,
  );
}
{
  const adapted = applyWorkforceTaskSpecs(
    planOf([readStep("t1", { resources: ["no-colon-key"] })]),
  );
  ok(
    !adapted.ok && adapted.code === "WORKFORCE_TASK_SPEC_INVALID",
    "P: 非法资源键（无 {entity}:{id} 结构）→ 整计划 FAIL VALIDATION（fail-closed）",
  );
}
{
  const adapted = applyWorkforceTaskSpecs(
    planOf([readStep("t1", { resources: ["quote:has space"] })]),
  );
  ok(
    !adapted.ok && adapted.code === "WORKFORCE_TASK_SPEC_INVALID",
    "P: id 含空白 → fail-closed",
  );
}
{
  const many = Array.from({ length: 9 }, (_, i) => `quote:q${i}`);
  const adapted = applyWorkforceTaskSpecs(planOf([readStep("t1", { resources: many })]));
  ok(
    !adapted.ok && adapted.code === "WORKFORCE_TASK_SPEC_INVALID",
    "P: 资源声明超上限（>8）→ fail-closed",
  );
}
{
  const adapted = applyWorkforceTaskSpecs(planOf([readStep("t1")]));
  const spec =
    adapted.ok &&
    readWorkforceTaskSpec({
      workforceTask: (adapted.plan.steps[0] as AnyRecord).workforceTask,
    });
  ok(
    adapted.ok && spec !== false && spec.kind === "valid" && spec.spec.resources === undefined,
    "P/§10: 未声明资源 → V1 spec 不含 resources（backward-compatible optional）",
  );
}
{
  // 旧 V1 记录（无 resources 字段）在新 reader 下照常 parse
  const legacy = {
    contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
    worker: { workerKey: "sales_worker", role: "sales_specialist" },
    taskKind: "work",
    objective: "旧记录",
  };
  const parsed = WorkforceTaskSpecV1Schema.safeParse(legacy);
  ok(
    parsed.success && parsed.data.resources === undefined,
    "P/§10: 旧 V1 记录（无 resources）新 reader 兼容（不破坏旧 V1）",
  );
}

// ══ §11 并行上限 ══
console.log("\n[§11 并行上限 clamp]");
ok(
  getWorkforceMaxParallelTasksWithEnv({}) === 1 &&
    WORKFORCE_JOB_MAX_PARALLEL_TASKS_DEFAULT === 1,
  "P: 未配置 → default 1（production default stays 1）",
);
ok(
  getWorkforceMaxParallelTasksWithEnv({ WORKFORCE_JOB_MAX_PARALLEL_TASKS: "3" }) === 3,
  "P: 显式 3 → 3",
);
ok(
  getWorkforceMaxParallelTasksWithEnv({ WORKFORCE_JOB_MAX_PARALLEL_TASKS: "0" }) === 1 &&
    getWorkforceMaxParallelTasksWithEnv({ WORKFORCE_JOB_MAX_PARALLEL_TASKS: "-2" }) === 1,
  "P: minimum 1（0/-2 → 1）",
);
ok(
  getWorkforceMaxParallelTasksWithEnv({ WORKFORCE_JOB_MAX_PARALLEL_TASKS: "9" }) ===
    WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX &&
    WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX === 4,
  "P: hard max 4（9 → 4）",
);
ok(
  getWorkforceMaxParallelTasksWithEnv({ WORKFORCE_JOB_MAX_PARALLEL_TASKS: "abc" }) === 1,
  "P: 非数字 → default 1",
);

// ══ §14 batch 组装 ══
console.log("\n[§14 bounded batch 组装]");
const S = (key: string, over: Partial<TaskPolicyStepInput> = {}) =>
  stepOf({ stepKey: key, ...over });
{
  const batch = buildParallelBatch({
    ready: [S("a"), S("b"), S("c"), S("d")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.map((s) => s.step.stepKey).join(",") === "a,b,c" &&
      batch.selected.every((s) => s.policy === "SAFE_PARALLEL"),
    "P: 4 个 SAFE + 上限 3 → batch=[a,b,c]（bounded，绝不超上限）",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("a"), S("b")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 1,
  });
  ok(
    batch.selected.length === 1 && batch.selected[0].step.stepKey === "a",
    "P/§11: 上限=1 → 恒 [队首]（回滚保证，与单步语义一致）",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("e", { requiresApproval: true }), S("a"), S("b")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.length === 1 &&
      batch.selected[0].step.stepKey === "e" &&
      batch.selected[0].policy === "REQUIRES_APPROVAL",
    "P/§8: 队首审批任务 → 单独成 batch（绝不与其他任务同批）",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("a"), S("e", { requiresApproval: true }), S("b")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.map((s) => s.step.stepKey).join(",") === "a,b" &&
      batch.deferred.some(
        (d) => d.step.stepKey === "e" && d.policy === "REQUIRES_APPROVAL",
      ),
    "P/§20: SAFE batch 收集时跳过审批任务（audit 记入 deferred）",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("a"), S("q", { riskLevel: "HIGH" }), S("b")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.map((s) => s.step.stepKey).join(",") === "a,b",
    "P/§27: SEQUENTIAL 任务不进 SAFE batch",
  );
}
{
  const batch = buildParallelBatch({
    ready: [
      S("a", { inputJson: specJson({ resources: ["quote:q1"] }) }),
      S("b", { inputJson: specJson({ resources: ["quote:q1"] }) }),
      S("c", { inputJson: specJson({ resources: ["quote:q2"] }) }),
    ],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.map((s) => s.step.stepKey).join(",") === "a,c" &&
      batch.deferred.some(
        (d) => d.step.stepKey === "b" && d.policy === "EXCLUSIVE_RESOURCE",
      ),
    "P/§28: 同资源 quote:q1 不同批（b deferred）；quote:q2 无冲突可同批",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("a", { inputJson: specJson({ resources: ["quote:q1"] }) }), S("b")],
    occupiedResourceKeys: new Set(["quote:q1"]),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.length === 0 &&
      batch.deferred.some(
        (d) => d.step.stepKey === "a" && d.policy === "EXCLUSIVE_RESOURCE",
      ),
    "P/§9: 队首资源被 running/awaiting 占用 → 本轮不启动（受控串行）",
  );
}
{
  const batch = buildParallelBatch({
    ready: [S("q", { riskLevel: "HIGH" }), S("a"), S("b")],
    occupiedResourceKeys: new Set(),
    maxParallelTasks: 3,
  });
  ok(
    batch.selected.length === 1 && batch.selected[0].step.stepKey === "q",
    "P: 队首 SEQUENTIAL → 单独成 batch（head-of-line，不跳队首）",
  );
}

finish();
