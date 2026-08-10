/**
 * Phase 2B-1 — Task/Worker/Handoff 契约纯函数测试（无 DB）
 *
 * 覆盖：Worker Registry 校验（§42 单元层）、Task Spec server 指派、
 * Golden Fixtures H1–H5（§40）、尺寸边界（§19）、幂等构建（§31）、
 * deterministic 上游顺序（§24）、legacy-absent 上游容忍。
 *
 * 运行：npx tsx <本文件>（不需要 DATABASE_URL）
 */

import { ok, finish } from "./helpers";
import {
  FROZEN_HANDOFF_V1_TASK_A,
  FROZEN_HANDOFF_V1_UPSTREAM_SET,
  FIXTURE_HANDOFF_UNKNOWN_VERSION,
  FIXTURE_HANDOFF_AUTH_FORGERY,
  FIXTURE_HANDOFF_MALFORMED,
} from "./fixtures/handoff-v1-golden";
import {
  getWorkforceWorker,
  isKnownWorkforceWorker,
  workerSupportsTaskKind,
  defaultWorkerKeyForTaskKind,
} from "../workers";
import {
  applyWorkforceTaskSpecs,
  readWorkforceTaskSpec,
  WORKFORCE_TASK_CONTRACT_VERSION,
} from "../task-contract";
import {
  buildWorkforceHandoffV1,
  collectUpstreamHandoffs,
  parseWorkforceHandoff,
  extractHandoffFromStepOutput,
  extractSynthesisHandoffSummary,
  FORBIDDEN_HANDOFF_AUTH_FIELDS,
  WORKFORCE_HANDOFF_CONTRACT_VERSION,
  WORKFORCE_HANDOFF_LIMITS,
} from "../handoff";
import type { PlannerOutput } from "@/lib/agent-runtime-v2/schemas";

function basePlan(
  steps: Array<Record<string, unknown>>,
): PlannerOutput {
  return {
    objective: "契约测试计划",
    summary: "契约测试计划",
    assumptions: [],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      { id: "c1", description: "全部步骤完成", verificationType: "tool_result" },
    ],
    steps: steps as PlannerOutput["steps"],
  } as PlannerOutput;
}

function step(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
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

async function main() {
  console.log("Phase 2B-1 — 契约纯函数测试\n");

  // ── Worker Registry（§9/§42）──
  console.log("[Worker Registry]");
  ok(isKnownWorkforceWorker("sales_worker"), "已知 workerKey 命中 registry");
  ok(!isKnownWorkforceWorker("evil_worker"), "unknown workerKey 不命中");
  ok(
    workerSupportsTaskKind("synthesis_worker", "synthesis") &&
      !workerSupportsTaskKind("synthesis_worker", "work"),
    "synthesis_worker 只承担 synthesis",
  );
  ok(
    workerSupportsTaskKind("sales_worker", "work") &&
      !workerSupportsTaskKind("sales_worker", "synthesis"),
    "sales_worker 只承担 work",
  );
  ok(
    defaultWorkerKeyForTaskKind("work") === "sales_worker" &&
      defaultWorkerKeyForTaskKind("synthesis") === "synthesis_worker",
    "server 默认指派 deterministic",
  );
  const salesDef = getWorkforceWorker("sales_worker");
  ok(
    !!salesDef &&
      !("userId" in salesDef) &&
      !("orgId" in salesDef) &&
      !("scope" in salesDef) &&
      !("permissions" in salesDef) &&
      !("authorized" in salesDef),
    "Worker Definition 不含任何授权语义字段（execution/profile registry）",
  );

  // ── Task Spec server 指派（§10–§12）──
  console.log("\n[Task Contract V1]");
  const applied = applyWorkforceTaskSpecs(
    basePlan([
      step("a"),
      step("b", { workerKey: "tender_worker" }),
      step("s", {
        workerKey: "synthesis_worker",
        taskKind: "synthesis",
        dependsOn: ["a", "b"],
      }),
    ]),
  );
  ok(applied.ok, "合法计划通过 server 校验");
  if (applied.ok) {
    const specs = applied.plan.steps.map(
      (s) => (s as { workforceTask?: unknown }).workforceTask,
    );
    const sa = readWorkforceTaskSpec({ workforceTask: specs[0] });
    const sb = readWorkforceTaskSpec({ workforceTask: specs[1] });
    const ss = readWorkforceTaskSpec({ workforceTask: specs[2] });
    ok(
      sa.kind === "valid" &&
        sa.spec.contractVersion === WORKFORCE_TASK_CONTRACT_VERSION &&
        sa.spec.worker.workerKey === "sales_worker" &&
        sa.spec.taskKind === "work",
      "未提议 → server 默认指派 sales_worker/work",
    );
    ok(
      sb.kind === "valid" && sb.spec.worker.workerKey === "tender_worker",
      "合法提议 workerKey 被采纳",
    );
    ok(
      sb.kind === "valid" && sb.spec.worker.role === "tender_specialist",
      "role 由 server registry 注入（不信任 LLM）",
    );
    ok(
      ss.kind === "valid" &&
        ss.spec.taskKind === "synthesis" &&
        ss.spec.worker.workerKey === "synthesis_worker",
      "synthesis 任务 + synthesis worker 通过",
    );
  }

  const unknownWorker = applyWorkforceTaskSpecs(
    basePlan([step("a", { workerKey: "made_up_worker" })]),
  );
  ok(
    !unknownWorker.ok && unknownWorker.code === "WORKFORCE_WORKER_INVALID",
    "unknown workerKey → FAIL VALIDATION（fail-closed，不静默替换）",
  );
  const kindMismatch = applyWorkforceTaskSpecs(
    basePlan([step("a", { workerKey: "synthesis_worker", taskKind: "work" })]),
  );
  ok(
    !kindMismatch.ok && kindMismatch.code === "WORKFORCE_WORKER_INVALID",
    "worker 不支持 taskKind → FAIL VALIDATION",
  );

  const badSpec = readWorkforceTaskSpec({
    workforceTask: { contractVersion: "workforce-task/v999" },
  });
  ok(badSpec.kind === "invalid", "损坏/未知版本 task spec → invalid（调用方 fail-closed）");
  ok(
    readWorkforceTaskSpec(null).kind === "absent" &&
      readWorkforceTaskSpec({}).kind === "absent",
    "无 spec → absent（legacy 兼容）",
  );

  // ── H1：Normal V1（A → B）──
  console.log("\n[H1 Normal A→B]");
  const completedAt = new Date("2026-08-10T08:00:00.000Z");
  const builtA = buildWorkforceHandoffV1({
    runId: "run_h1",
    stepKey: "task_a",
    workerKey: "sales_worker",
    taskKind: "work",
    stepStatus: "completed",
    taskObjective: "读取销售管道",
    businessOutput: {
      opportunityCount: 2,
      customerId: "cust_1",
      sample: [{ id: "opp_1" }],
    },
    completedAt,
  });
  ok(builtA.ok, "H1: builder 产出合法 V1");
  if (builtA.ok) {
    ok(
      builtA.payload.contractVersion === WORKFORCE_HANDOFF_CONTRACT_VERSION &&
        builtA.payload.source.runId === "run_h1" &&
        builtA.payload.source.stepKey === "task_a" &&
        builtA.payload.source.workerKey === "sales_worker",
      "H1: source 由 server 注入",
    );
    ok(
      builtA.payload.createdAt === completedAt.toISOString(),
      "H1: createdAt = Step durable completion time",
    );
    ok(
      builtA.payload.businessRefs?.includes("customer:cust_1") === true,
      "H1: businessRefs 提取 {entity}:{id}",
    );
    const consumed = collectUpstreamHandoffs({
      runId: "run_h1",
      dependsOnJson: ["task_a"],
      steps: [
        {
          stepKey: "task_a",
          status: "completed",
          inputJson: null,
          outputJson: { opportunityCount: 2, workforceHandoff: builtA.payload },
        },
      ],
    });
    ok(
      consumed.ok &&
        consumed.upstream.length === 1 &&
        consumed.upstream[0].payload.summary === builtA.payload.summary,
      "H1: 下游按依赖取得 validated handoff（业务上下文完整）",
    );
  }

  // ── H2：A/B/C → Synthesis，deterministic 顺序 ──
  console.log("\n[H2 Multi-upstream Synthesis]");
  const upstreamSteps = FROZEN_HANDOFF_V1_UPSTREAM_SET.map((h) => ({
    stepKey: h.source.stepKey,
    status: "completed",
    inputJson: null,
    outputJson: { workforceHandoff: h },
  }));
  // 声明序特意与字典序/入库序不同：c, a, b
  const declared = ["task_c", "task_a", "task_b"];
  const multi = collectUpstreamHandoffs({
    runId: "run_frozen_2b1",
    dependsOnJson: declared,
    steps: [...upstreamSteps].reverse(),
  });
  ok(
    multi.ok &&
      multi.upstream.map((u) => u.stepKey).join(",") === declared.join(","),
    "H2: 上游顺序 = dependsOn 声明序（非 DB 行序）",
    multi.ok ? multi.upstream.map((u) => u.stepKey) : multi,
  );
  if (multi.ok) {
    const synth = buildWorkforceHandoffV1({
      runId: "run_frozen_2b1",
      stepKey: "task_s",
      workerKey: "synthesis_worker",
      taskKind: "synthesis",
      stepStatus: "completed",
      taskObjective: "合并 A/B/C 结论",
      businessOutput: { merged: true },
      completedAt,
      upstreamHandoffs: multi.upstream,
    });
    ok(synth.ok, "H2: synthesis handoff 构建成功");
    if (synth.ok) {
      const ups = (synth.payload.outputs?.upstreamSummaries ?? []) as Array<{
        stepKey: string;
        workerKey: string;
        summary: string;
      }>;
      ok(
        ups.map((u) => u.stepKey).join(",") === declared.join(",") &&
          ups.every((u) => typeof u.summary === "string" && u.summary.length > 0),
        "H2: synthesis 获得三个 deterministic 上游摘要",
      );
      const report = extractSynthesisHandoffSummary("run_frozen_2b1", [
        {
          stepKey: "task_s",
          status: "completed",
          inputJson: {
            workforceTask: {
              contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
              worker: { workerKey: "synthesis_worker", role: "synthesis_lead" },
              taskKind: "synthesis",
              objective: "合并 A/B/C 结论",
            },
          },
          outputJson: { workforceHandoff: synth.payload },
        },
      ]);
      ok(
        report !== null && report.summary === synth.payload.summary,
        "H2: synthesis handoff 可作为最终 Job result 来源",
      );
    }
  }

  // ── H3：冻结的旧 V1 仍可解析 ──
  console.log("\n[H3 Frozen V1 forward-compat]");
  const frozen = parseWorkforceHandoff(
    JSON.parse(JSON.stringify(FROZEN_HANDOFF_V1_TASK_A)),
  );
  ok(
    frozen.ok && frozen.payload.source.stepKey === "task_a",
    "H3: 已持久化旧 workforce-handoff/v1 在当前代码仍能 parse",
  );

  // ── H4：未知版本 fail-closed ──
  console.log("\n[H4 Unknown version]");
  const unknown = parseWorkforceHandoff(
    JSON.parse(JSON.stringify(FIXTURE_HANDOFF_UNKNOWN_VERSION)),
  );
  ok(
    !unknown.ok && unknown.code === "HANDOFF_VERSION_UNSUPPORTED",
    "H4: v999 → HANDOFF_VERSION_UNSUPPORTED（fail-closed）",
  );
  const unknownConsume = collectUpstreamHandoffs({
    runId: "run_frozen_2b1",
    dependsOnJson: ["task_a"],
    steps: [
      {
        stepKey: "task_a",
        status: "completed",
        inputJson: null,
        outputJson: {
          workforceHandoff: JSON.parse(
            JSON.stringify(FIXTURE_HANDOFF_UNKNOWN_VERSION),
          ),
        },
      },
    ],
  });
  ok(
    !unknownConsume.ok && unknownConsume.code === "HANDOFF_VERSION_UNSUPPORTED",
    "H4: 下游消费 unknown version → fail closed（不得以 raw data 执行）",
  );

  // ── H5：授权伪造 sanitize ──
  console.log("\n[H5 Auth forgery sanitize]");
  const forged = parseWorkforceHandoff(
    JSON.parse(JSON.stringify(FIXTURE_HANDOFF_AUTH_FORGERY)),
  );
  ok(forged.ok, "H5: 伪造 payload 结构上可解析（V1 合法部分）");
  if (forged.ok) {
    const sanitized = forged.payload as Record<string, unknown>;
    const leaked = FORBIDDEN_HANDOFF_AUTH_FIELDS.filter(
      (f) => f in sanitized,
    );
    ok(
      leaked.length === 0,
      "H5: sanitize 后所有授权语义字段全部剥离（NO AUTH ESCALATION）",
      leaked,
    );
    ok(
      (sanitized.outputs as Record<string, unknown>).note === "business data",
      "H5: 业务数据保留",
    );
  }

  // ── malformed fail-closed ──
  const malformed = parseWorkforceHandoff(
    JSON.parse(JSON.stringify(FIXTURE_HANDOFF_MALFORMED)),
  );
  ok(
    !malformed.ok && malformed.code === "HANDOFF_MALFORMED",
    "malformed payload → HANDOFF_MALFORMED（fail-closed）",
  );
  ok(!parseWorkforceHandoff("str").ok && !parseWorkforceHandoff(null).ok, "非对象 → fail-closed");

  // ── 尺寸边界（§19）──
  console.log("\n[Size boundary]");
  const huge = "x".repeat(WORKFORCE_HANDOFF_LIMITS.maxSerializedBytes + 1);
  const oversize = parseWorkforceHandoff({
    contractVersion: WORKFORCE_HANDOFF_CONTRACT_VERSION,
    source: { runId: "r", stepKey: "s", workerKey: "w" },
    summary: "ok",
    outputs: { huge },
    createdAt: "2026-08-10T00:00:00.000Z",
  });
  ok(
    !oversize.ok && oversize.code === "HANDOFF_TOO_LARGE",
    "读侧：超过 maxSerializedBytes → fail closed",
  );
  const boundedBuild = buildWorkforceHandoffV1({
    runId: "run_big",
    stepKey: "task_big",
    workerKey: "sales_worker",
    taskKind: "work",
    stepStatus: "completed",
    taskObjective: "大输出任务",
    businessOutput: {
      hugeField: "y".repeat(200_000),
      hugeList: Array.from({ length: 5000 }, (_, i) => ({ i, pad: "z".repeat(20) })),
      small: "kept",
    },
    completedAt,
  });
  ok(boundedBuild.ok, "写侧：1MB 级原始输出被 builder 有界化（不 dump 进信封）");
  if (boundedBuild.ok) {
    const s = JSON.stringify(boundedBuild.payload);
    ok(
      s.length <= WORKFORCE_HANDOFF_LIMITS.maxSerializedBytes,
      `写侧：信封总大小 ≤ ${WORKFORCE_HANDOFF_LIMITS.maxSerializedBytes}`,
      s.length,
    );
    const outs = boundedBuild.payload.outputs as Record<string, unknown>;
    ok(
      (outs.hugeField as { truncated?: boolean })?.truncated === true &&
        (outs.hugeList as { count?: number })?.count === 5000 &&
        outs.small === "kept",
      "写侧：超预算字段截断占位、小字段保留、数组保留 count",
    );
    ok(
      (boundedBuild.payload.warnings ?? []).some((w) => w.includes("截断")),
      "写侧：截断在 warnings 中可见",
    );
  }
  const longSummary = buildWorkforceHandoffV1({
    runId: "r",
    stepKey: "s",
    workerKey: "sales_worker",
    taskKind: "work",
    stepStatus: "completed",
    taskObjective: "o",
    businessOutput: { summary: "s".repeat(10_000) },
    completedAt,
  });
  ok(
    longSummary.ok &&
      longSummary.payload.summary.length <=
        WORKFORCE_HANDOFF_LIMITS.maxSummaryLength,
    "写侧：summary 截断到上限",
  );

  // ── 幂等构建（§31）──
  console.log("\n[Idempotent build]");
  const buildInput = {
    runId: "run_idem",
    stepKey: "task_i",
    workerKey: "sales_worker",
    taskKind: "work" as const,
    stepStatus: "completed" as const,
    taskObjective: "幂等验证",
    businessOutput: { a: 1, b: ["x"] },
    completedAt: new Date("2026-08-10T09:00:00.000Z"),
  };
  const b1 = buildWorkforceHandoffV1(buildInput);
  const b2 = buildWorkforceHandoffV1(buildInput);
  ok(
    b1.ok &&
      b2.ok &&
      JSON.stringify(b1.payload) === JSON.stringify(b2.payload),
    "同一 durable 输入重复构建 → 语义等同（无随机 ID / wall clock）",
  );

  // ── source 交叉核对（§21）──
  console.log("\n[Source cross-check]");
  if (builtA.ok) {
    const wrongRun = collectUpstreamHandoffs({
      runId: "run_other",
      dependsOnJson: ["task_a"],
      steps: [
        {
          stepKey: "task_a",
          status: "completed",
          inputJson: null,
          outputJson: { workforceHandoff: builtA.payload },
        },
      ],
    });
    ok(
      !wrongRun.ok && wrongRun.code === "HANDOFF_SOURCE_MISMATCH",
      "source.runId 与消费 run 不符 → fail closed",
    );
    const wrongWorker = collectUpstreamHandoffs({
      runId: "run_h1",
      dependsOnJson: ["task_a"],
      steps: [
        {
          stepKey: "task_a",
          status: "completed",
          inputJson: {
            workforceTask: {
              contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
              worker: { workerKey: "tender_worker", role: "tender_specialist" },
              taskKind: "work",
              objective: "o",
            },
          },
          outputJson: { workforceHandoff: builtA.payload },
        },
      ],
    });
    ok(
      !wrongWorker.ok && wrongWorker.code === "HANDOFF_SOURCE_MISMATCH",
      "source.workerKey 与上游任务指派不符 → fail closed",
    );
  }

  // ── 上游缺行/未终态 fail-closed；legacy 无信封容忍 ──
  console.log("\n[Upstream boundaries]");
  const missingRow = collectUpstreamHandoffs({
    runId: "r",
    dependsOnJson: ["ghost"],
    steps: [],
  });
  ok(
    !missingRow.ok && missingRow.code === "HANDOFF_UPSTREAM_MISSING",
    "依赖步骤缺行 → fail closed",
  );
  const notTerminal = collectUpstreamHandoffs({
    runId: "r",
    dependsOnJson: ["task_a"],
    steps: [
      { stepKey: "task_a", status: "running", inputJson: null, outputJson: null },
    ],
  });
  ok(
    !notTerminal.ok && notTerminal.code === "HANDOFF_UPSTREAM_MISSING",
    "依赖步骤未终态 → fail closed",
  );
  const legacyAbsent = collectUpstreamHandoffs({
    runId: "r",
    dependsOnJson: ["task_a"],
    steps: [
      {
        stepKey: "task_a",
        status: "completed",
        inputJson: null,
        outputJson: { businessOnly: true },
      },
    ],
  });
  ok(
    legacyAbsent.ok && legacyAbsent.upstream.length === 0,
    "终态上游无信封（legacy-completed）→ 容忍跳过（不阻断、不注入）",
  );
  ok(
    extractHandoffFromStepOutput({ workforceHandoff: null }) === undefined,
    "envelope=null 视为 absent",
  );

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
