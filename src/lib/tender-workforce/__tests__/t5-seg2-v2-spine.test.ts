/**
 * T5-P1 Segment 2 — canonical V2 持久化脊柱（纯平面，零 DB / 零 LLM）
 *
 * V2-SPINE-01..18：核心共享、两侧 fence 各自把门、Workforce 域归属 fail-closed、
 * 状态不被改动、summaryJson 语义完整、fence 不泄漏、新工具休眠但可执行。
 *
 * 运行：npx tsx src/lib/tender-workforce/__tests__/t5-seg2-v2-spine.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  persistV2CanonicalTx,
  type V2PersistTx,
} from "@/lib/tender-auto-analysis/v2-persist-core";
import {
  persistV2Fenced,
  isEmptyAnalysisOutcome,
} from "@/lib/tender-auto-analysis/v2-persist";
import type { V2MappedResult } from "@/lib/tender-auto-analysis/v2-map";
import {
  persistV2ForWorkforce,
  WorkforceTenderDomainOwnershipError,
  WORKFORCE_V2_TX_OPTIONS,
} from "../v2-persist-workforce";
import {
  buildWorkforceTenderIdempotencyKey,
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
} from "../analysis-run-service";
import {
  TENDER_WORKFORCE_TOOL_DESCRIPTORS,
  TENDER_WORKFORCE_TOOL_HANDLERS,
  TENDER_WORKFORCE_PLANNER_TOOL_NAMES,
  tenderWorkforcePlannerTools,
} from "../tools";
import {
  getExecutionToolPolicyDescriptor,
  executionRiskForDescriptor,
} from "@/lib/workforce-runtime/execution-descriptor";
import { plannerVisibleRuntimeV2Tools } from "@/lib/agent-runtime-v2/tool-catalog";
import { LostLeaseError, type RunFence } from "@/lib/agent-runtime/lease";
import { TenderV2LeaseLostError } from "@/lib/tender-auto-analysis/v2-persist";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const ROOT = join(process.cwd(), "src", "lib");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ═══════════════════ fixtures ═══════════════════ */

const ORG = "org_seg2";
const PROJECT = "proj_seg2";
const RUN = "run_seg2";
const JOB = "job_seg2";

/** canonical V2 summaryJson 的全部语义字段（V2-SPINE-12 逐个断言存活） */
const V2_SUMMARY_FIELDS = [
  "engine",
  "brief",
  "criticalFacts",
  "submissionChecklist",
  "unknowns",
  "conflicts",
  "addendumChanges",
  "evidenceCoverage",
  "analystSynthesis",
  "metadata",
] as const;

function mappedFixture(): V2MappedResult {
  return {
    facts: [
      {
        statementKind: "DEADLINE",
        contentZh: "截标 2026-09-01",
        contentOriginal: "Closing 2026-09-01",
        confidence: "HIGH",
        sourceRefs: [
          {
            documentId: "doc1",
            pageNumber: 3,
            originalTextSnippet: "Closing…",
            sectionLabel: null,
            extractionMethod: "llm",
            confidence: "HIGH",
          },
        ],
      },
    ],
    requirements: [
      {
        requirementCode: "REQ-001",
        category: "SUBMISSION",
        originalRequirement: "Submit technical proposal",
        chineseTranslation: "提交技术方案",
        mandatory: true,
        evidenceRequired: true,
        complianceStatus: "UNKNOWN",
        sourcePage: 5,
        sourceRefs: [],
      },
    ],
    clarifications: [
      {
        question: "预算上限？",
        reason: "文档未披露",
        priority: "HIGH",
        enquiryDeadline: null,
        sourceRefs: [],
      },
    ],
    changeCandidates: [],
    sections: [],
    summaryText: "V2 摘要",
    summaryJson: Object.fromEntries(
      V2_SUMMARY_FIELDS.map((f) => [f, f === "engine" ? "v2" : { f: true }]),
    ) as Record<string, unknown>,
  } as unknown as V2MappedResult;
}

type Recorded = { model: string; op: string; args: Record<string, unknown> };

/** 记录型 fake tx：既统计 canonical 写，也按 where 子句真实匹配（迷你 DB） */
function makeFakeTx(input: {
  /** tenderAnalysisRun.updateMany 的匹配基准（不传即恒匹配） */
  row?: Record<string, unknown>;
  /** 注入异常：在第 n 次 canonical 写时抛错（原子性测试） */
  throwOnWrite?: number;
}): { tx: V2PersistTx; writes: Recorded[] } {
  const writes: Recorded[] = [];
  let writeSeq = 0;
  const rec = (model: string, op: string) => async (args: unknown) => {
    // deleteMany/updateMany(fence 断言) 不计为 canonical 写
    const isCanonicalWrite = op === "create" || op === "createMany" || op === "upsert" || (model === "tenderAnalysisRun" && op === "update");
    if (isCanonicalWrite) {
      writeSeq += 1;
      if (input.throwOnWrite && writeSeq === input.throwOnWrite) {
        throw new Error("INJECTED_MIDWAY_FAILURE");
      }
    }
    writes.push({ model, op, args: (args ?? {}) as Record<string, unknown> });
    return { count: 1, id: `${model}_${writes.length}` };
  };

  const runUpdateMany = async (args: unknown) => {
    const where = ((args ?? {}) as { where?: Record<string, unknown> }).where ?? {};
    writes.push({ model: "tenderAnalysisRun", op: "updateMany", args: (args ?? {}) as Record<string, unknown> });
    if (!input.row) return { count: 1 };
    const matched = Object.entries(where).every(([k, v]) => {
      const actual = input.row![k];
      if (v !== null && typeof v === "object") return true; // 非标量条件（如 status:{in}）不在本 fake 内判定
      return actual === v;
    });
    return { count: matched ? 1 : 0 };
  };

  const tx = {
    tenderAnalysisRun: {
      updateMany: runUpdateMany,
      update: rec("tenderAnalysisRun", "update"),
    },
    tenderAnalysisSourceRef: {
      deleteMany: rec("tenderAnalysisSourceRef", "deleteMany"),
      create: rec("tenderAnalysisSourceRef", "create"),
    },
    tenderAnalysisFact: {
      deleteMany: rec("tenderAnalysisFact", "deleteMany"),
      create: rec("tenderAnalysisFact", "create"),
    },
    tenderExtractedRequirement: {
      deleteMany: rec("tenderExtractedRequirement", "deleteMany"),
      create: rec("tenderExtractedRequirement", "create"),
    },
    tenderClarificationQuestion: {
      deleteMany: rec("tenderClarificationQuestion", "deleteMany"),
      create: rec("tenderClarificationQuestion", "create"),
    },
    tenderAnalysisChangeCandidate: {
      deleteMany: rec("tenderAnalysisChangeCandidate", "deleteMany"),
      createMany: rec("tenderAnalysisChangeCandidate", "createMany"),
    },
    tenderAnalysisSection: { upsert: rec("tenderAnalysisSection", "upsert") },
  } as unknown as V2PersistTx;

  return { tx, writes };
}

const canonicalWrites = (w: Recorded[]) =>
  w.filter(
    (r) =>
      r.op === "create" ||
      r.op === "createMany" ||
      r.op === "upsert" ||
      r.op === "deleteMany" ||
      (r.model === "tenderAnalysisRun" && r.op === "update"),
  );

/** 有效的 Workforce fence（直接把 fake tx 交给写入回调） */
function fakeFence(tx: V2PersistTx, sink?: { options?: unknown }): RunFence {
  return {
    runId: "agentrun_seg2",
    check: async () => true,
    guard: async (write, options) => {
      if (sink) sink.options = options;
      return write(tx as never);
    },
  };
}

/** 已失效的 fence：guard 在**写入回调执行前**抛错（真实 token 断言语义） */
function staleFence(): RunFence {
  return {
    runId: "agentrun_seg2",
    check: async () => false,
    guard: async () => {
      throw new LostLeaseError("agentrun_seg2");
    },
  };
}

const ownedRow = {
  id: RUN,
  orgId: ORG,
  projectId: PROJECT,
  analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
  status: TENDER_AGENT_RUN_STATUS.running,
  idempotencyKey: buildWorkforceTenderIdempotencyKey(JOB),
};

const wfArgs = (over?: Partial<Record<string, string>>) => ({
  orgId: over?.orgId ?? ORG,
  projectId: over?.projectId ?? PROJECT,
  analysisRunId: over?.analysisRunId ?? RUN,
  jobId: over?.jobId ?? JOB,
  mapped: mappedFixture(),
  model: "gpt-5.6-terra",
});

console.log("T5 Segment 2 — canonical V2 持久化脊柱（纯平面）");

(async () => {
  /* ── V2-SPINE-01：核心唯一实现，且被 legacy wrapper 复用 ── */
  {
    const coreSrc = read("tender-auto-analysis/v2-persist-core.ts");
    const legacySrc = read("tender-auto-analysis/v2-persist.ts");
    const wfSrc = read("tender-workforce/v2-persist-workforce.ts");
    ok(
      legacySrc.includes("persistV2CanonicalTx") &&
        wfSrc.includes("persistV2CanonicalTx"),
      "V2-SPINE-01: legacy 与 workforce 两个 wrapper 都调用共享核心",
    );
    // 重复实现检测：canonical 写只允许出现在核心里
    const dupMarkers = ["tenderAnalysisFact.create", "tenderExtractedRequirement.create", "tenderAnalysisSection.upsert"];
    ok(
      dupMarkers.every((m) => coreSrc.includes(m)) &&
        dupMarkers.every((m) => !legacySrc.includes(m) && !wfSrc.includes(m)),
      "V2-SPINE-01b: DUPLICATE_V2_PERSIST_LOGIC = 0（wrapper 内零 canonical 写语句）",
    );
    // 封装纪律：核心的导入方仅限两个 fenced wrapper（+ 测试）
    const allowed = [
      "tender-auto-analysis/v2-persist.ts",
      "tender-workforce/v2-persist-workforce.ts",
    ];
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      `grep -rl "v2-persist-core" ${JSON.stringify(ROOT)} || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(`${ROOT}/`, ""))
      .filter((f) => !f.includes("__tests__") && !f.endsWith("v2-persist-core.ts"));
    ok(
      hits.every((h) => allowed.includes(h)),
      "V2-SPINE-01c: 核心只被两个 fenced wrapper import（禁止绕过 fence）",
      hits,
    );
  }

  /* ── V2-SPINE-02：legacy stale lease → 零 canonical 写 ── */
  {
    const { tx, writes } = makeFakeTx({ row: { id: RUN, leaseOwner: "worker-A" } });
    let threw = "";
    try {
      await persistV2Fenced(
        {
          runId: RUN,
          projectId: PROJECT,
          leaseOwner: "worker-B", // 与行不符 → fence 命中 0 行
          leaseMs: 60_000,
          mapped: mappedFixture(),
          model: null,
        },
        (fn) => fn(tx),
      );
    } catch (e) {
      threw = e instanceof Error ? e.name : "unknown";
    }
    ok(
      threw === "TenderV2LeaseLostError" && canonicalWrites(writes).length === 0,
      "V2-SPINE-02: legacy stale lease → TenderV2LeaseLostError 且零 canonical 写",
      { threw, writes: canonicalWrites(writes).length },
    );
  }

  /* ── V2-SPINE-03：legacy 有效 lease → 正常落库 ── */
  {
    const { tx } = makeFakeTx({ row: { id: RUN, leaseOwner: "worker-A" } });
    const r = await persistV2Fenced(
      {
        runId: RUN,
        projectId: PROJECT,
        leaseOwner: "worker-A",
        leaseMs: 60_000,
        mapped: mappedFixture(),
        model: "m",
      },
      (fn) => fn(tx),
    );
    ok(
      r.factCount === 1 && r.requirementCount === 1 && r.clarificationCount === 1,
      "V2-SPINE-03: legacy 有效 lease → canonical 持久化成功",
      r,
    );
    ok(
      r.sectionCount === 16,
      "V2-SPINE-03b: 16 个报告章节全部 upsert",
      r.sectionCount,
    );
  }

  /* ── V2-SPINE-04：Workforce 有效 fence → 成功 ── */
  {
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    const sink: { options?: unknown } = {};
    const r = await persistV2ForWorkforce({
      ...wfArgs(),
      runFence: fakeFence(tx, sink),
    });
    ok(
      r.factCount === 1 && r.requirementCount === 1 && r.sectionCount === 16,
      "V2-SPINE-04: Workforce 有效 AgentRun fence → canonical 持久化成功",
      r,
    );
    ok(
      JSON.stringify(sink.options) === JSON.stringify(WORKFORCE_V2_TX_OPTIONS),
      "V2-SPINE-04b: 使用 maxWait 10s / timeout 120s 事务参数",
      sink.options,
    );
    ok(
      canonicalWrites(writes).length > 0,
      "V2-SPINE-04c: canonical 写发生在 fence 保护的同一事务内",
    );
  }

  /* ── V2-SPINE-05：Workforce stale fence → 零 canonical 写 ── */
  {
    const { writes } = makeFakeTx({ row: ownedRow });
    let threw = "";
    try {
      await persistV2ForWorkforce({ ...wfArgs(), runFence: staleFence() });
    } catch (e) {
      threw = e instanceof Error ? e.name : "unknown";
    }
    ok(
      threw === "LostLeaseError" && canonicalWrites(writes).length === 0,
      "V2-SPINE-05: Workforce stale fence → LostLeaseError 且零 canonical 写",
      { threw },
    );
  }

  /* ── V2-SPINE-06..10：域归属五道断言，任一不符即零写 ── */
  const ownershipCases: Array<[string, ReturnType<typeof wfArgs>, string]> = [
    ["V2-SPINE-06", wfArgs({ orgId: "org_other" }), "错误 org"],
    ["V2-SPINE-07", wfArgs({ projectId: "proj_other" }), "错误 project"],
    ["V2-SPINE-10", wfArgs({ jobId: "job_other" }), "错误 job（幂等键不符）"],
    ["V2-SPINE-10b", wfArgs({ analysisRunId: "run_other" }), "错误 analysisRunId"],
  ];
  for (const [id, args, label] of ownershipCases) {
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    let threw = "";
    try {
      await persistV2ForWorkforce({ ...args, runFence: fakeFence(tx) });
    } catch (e) {
      threw = e instanceof Error ? e.name : "unknown";
    }
    ok(
      threw === "WorkforceTenderDomainOwnershipError" &&
        canonicalWrites(writes).length === 0,
      `${id}: ${label} → 域归属 fail-closed，零 canonical 写`,
      { threw, writes: canonicalWrites(writes).length },
    );
  }
  {
    // V2-SPINE-08 / 09：where 子句必须真的带上 analysisVersion 与 status
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    await persistV2ForWorkforce({ ...wfArgs(), runFence: fakeFence(tx) });
    const assertion = writes.find(
      (w) => w.model === "tenderAnalysisRun" && w.op === "updateMany",
    );
    const where = (assertion?.args.where ?? {}) as Record<string, unknown>;
    ok(
      where.analysisVersion === TENDER_WORKFORCE_ANALYSIS_VERSION,
      "V2-SPINE-08: 归属断言含 analysisVersion（拒绝 legacy run）",
      where,
    );
    ok(
      where.status === TENDER_AGENT_RUN_STATUS.running &&
        where.idempotencyKey === buildWorkforceTenderIdempotencyKey(JOB),
      "V2-SPINE-09: 归属断言含 status=AGENT_ANALYZING 与 Job 幂等键",
      where,
    );
    ok(
      assertion !== undefined &&
        writes.indexOf(assertion) <
          writes.findIndex((w) => w.op === "deleteMany"),
      "V2-SPINE-09b: 归属断言发生在任何 canonical 写之前（同事务，无 TOCTOU）",
    );
  }

  /* ── V2-SPINE-11：持久化不改变 run 状态 ── */
  {
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    await persistV2ForWorkforce({ ...wfArgs(), runFence: fakeFence(tx) });
    const assertionData = (
      writes.find((w) => w.model === "tenderAnalysisRun" && w.op === "updateMany")
        ?.args.data ?? {}
    ) as Record<string, unknown>;
    const summaryUpdate = (
      writes.find((w) => w.model === "tenderAnalysisRun" && w.op === "update")
        ?.args.data ?? {}
    ) as Record<string, unknown>;
    ok(
      assertionData.status === TENDER_AGENT_RUN_STATUS.running &&
        summaryUpdate.status === undefined &&
        summaryUpdate.completedAt === undefined,
      "V2-SPINE-11: 持久化保持 AGENT_ANALYZING（Segment 2 不终态化）",
      { assertionData, summaryUpdate },
    );
  }

  /* ── V2-SPINE-12：summaryJson 全部 V2 语义字段落库 ── */
  {
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    await persistV2ForWorkforce({ ...wfArgs(), runFence: fakeFence(tx) });
    const data = (
      writes.find((w) => w.model === "tenderAnalysisRun" && w.op === "update")
        ?.args.data ?? {}
    ) as Record<string, unknown>;
    const sj = (data.summaryJson ?? {}) as Record<string, unknown>;
    const missing = V2_SUMMARY_FIELDS.filter((f) => sj[f] === undefined);
    ok(
      missing.length === 0 && data.summaryText === "V2 摘要" && data.model === "gpt-5.6-terra",
      "V2-SPINE-12: summaryJson 十个 V2 语义字段 + summaryText + model 全部落库",
      missing,
    );
  }

  /* ── V2-SPINE-13：fence 事务参数向后兼容 ── */
  {
    // 旧形状 guard（只接一个参数、忽略 options）必须仍然可用
    const { tx, writes } = makeFakeTx({ row: ownedRow });
    const legacyShaped: RunFence = {
      runId: "agentrun_seg2",
      check: async () => true,
      guard: (async (write: (t: unknown) => Promise<unknown>) =>
        write(tx)) as RunFence["guard"],
    };
    const r = await persistV2ForWorkforce({
      ...wfArgs(),
      runFence: legacyShaped,
    });
    ok(
      r.sectionCount === 16 && canonicalWrites(writes).length > 0,
      "V2-SPINE-13: 忽略 options 的旧形状 guard 行为不变（向后兼容）",
    );
    const leaseSrc = read("agent-runtime/lease.ts");
    ok(
      leaseSrc.includes("options?: FenceTxOptions") &&
        leaseSrc.includes("}, options),"),
      "V2-SPINE-13b: createRunFence 透传可选事务参数（不传即 Prisma 默认）",
    );
  }

  /* ── V2-SPINE-14：fence 不进入任何序列化面 ── */
  {
    const { execSync } = await import("node:child_process");
    const hits = execSync(`grep -rln "runFence" ${JSON.stringify(ROOT)} || true`, {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(`${ROOT}/`, ""))
      .filter((f) => !f.includes("__tests__"));
    const allowed = [
      "agent-runtime-v2/adapters.ts", // 类型声明（server-only 注入点）
      "agent-runtime-v2/executor.ts", // 唯一注入者
      "tender-workforce/tools.ts", // 唯一消费者
      "tender-workforce/v2-persist-workforce.ts",
    ];
    ok(
      hits.every((h) => allowed.includes(h)),
      "V2-SPINE-14: runFence 仅出现在 server 注入/消费点",
      hits,
    );
    const handoffSrc = read("workforce-runtime/handoff.ts");
    const taskSrc = read("workforce-runtime/task-contract.ts");
    const jobSrc = read("workforce-runtime/job.ts");
    ok(
      !handoffSrc.includes("runFence") &&
        !taskSrc.includes("runFence") &&
        !jobSrc.includes("runFence"),
      "V2-SPINE-14b: handoff / task contract / job metadata 零 fence 字段",
    );
    // 工具输出（会被写进 outputJson / handoff）不含 fence
    const toolsSrc = read("tender-workforce/tools.ts");
    const returnsFence = /data:\s*{[^}]*runFence/s.test(toolsSrc);
    ok(!returnsFence, "V2-SPINE-14c: 工具返回数据不含 fence（不会落 outputJson）");
  }

  /* ── V2-SPINE-15：新工具不在任何 planner 投影里 ── */
  {
    const plannerNames = tenderWorkforcePlannerTools().map((t) => t.name);
    ok(
      !plannerNames.includes("tender_analyze_package_v2") &&
        plannerNames.length === TENDER_WORKFORCE_PLANNER_TOOL_NAMES.length,
      "V2-SPINE-15: tender_analyze_package_v2 不在 tender planner 投影内",
      plannerNames,
    );
    ok(
      !plannerVisibleRuntimeV2Tools().some((t) =>
        t.name.startsWith("tender_"),
      ),
      "V2-SPINE-15b: 全局 planner 投影仍零 tender 工具",
    );
    ok(
      typeof TENDER_WORKFORCE_TOOL_HANDLERS.tender_analyze_package_v2 ===
        "function",
      "V2-SPINE-15c: 但它是可执行的（EXECUTABLE ⊋ PLANNER_VISIBLE）",
    );
    // Segment 3 起该工具**已接线**进确定性 DAG（这正是 Segment 3 的目的）；
    // 休眠约束只对 LLM 兼容面成立。
    const dagSrc = read("tender-workforce/deterministic-plan.ts");
    ok(
      dagSrc.includes("tender_analyze_package_v2"),
      "V2-SPINE-15d: 确定性 DAG 已接线 canonical V2 工具（Segment 3）",
    );
  }

  /* ── V2-SPINE-16：执行策略 descriptor 存在且可解析风险 ── */
  {
    const d = getExecutionToolPolicyDescriptor("tender_analyze_package_v2");
    ok(
      d !== null && d.requiresApproval === false && d.readOnly === false,
      "V2-SPINE-16: 新工具有执行策略 descriptor（未知 descriptor 仍 fail-closed）",
      d,
    );
    ok(
      d !== null && executionRiskForDescriptor(d) === "l1_internal_write",
      "V2-SPINE-16b: 风险映射为 l1_internal_write（写型内部分析）",
      d ? executionRiskForDescriptor(d) : null,
    );
    ok(
      TENDER_WORKFORCE_TOOL_DESCRIPTORS.length ===
        Object.keys(TENDER_WORKFORCE_TOOL_HANDLERS).length,
      "V2-SPINE-16c: descriptor 覆盖率 100%（可执行集合无裸奔工具）",
    );
  }

  /* ── V2-SPINE-17：域约束（source-level；真实拒绝在 DB 矩阵里跑） ── */
  {
    const toolsSrc = read("tender-workforce/tools.ts");
    const handler = toolsSrc.slice(
      toolsSrc.indexOf("async function handleAnalyzePackageV2"),
      toolsSrc.indexOf("/* ══════════════════ Handler 注册表"),
    );
    ok(
      handler.indexOf("requireTenderJobContext") <
        handler.indexOf("runV2Inference") &&
        handler.includes("requireManifestFromEvidence"),
      "V2-SPINE-17: 先自证 tender workDomain + 归属，才允许进入推理/落库",
    );
    ok(
      handler.indexOf("if (!runFence)") < handler.indexOf("runV2Inference"),
      "V2-SPINE-17b: 无写防栅栏时在推理之前就 fail-closed",
    );
  }

  /* ── V2-SPINE-18：空分析护栏复用同一 predicate ── */
  {
    const toolsSrc = read("tender-workforce/tools.ts");
    ok(
      toolsSrc.includes("isEmptyAnalysisOutcome"),
      "V2-SPINE-18: 复用既有 isEmptyAnalysisOutcome（不发明第二套判定）",
    );
    ok(
      isEmptyAnalysisOutcome({
        llmCalls: 120,
        llmFailures: 120,
        factCount: 0,
        requirementCount: 0,
      }) === true &&
        isEmptyAnalysisOutcome({
          llmCalls: 10,
          llmFailures: 1,
          factCount: 3,
          requirementCount: 2,
        }) === false,
      "V2-SPINE-18b: 全失败零产出=空壳；有成功产出=正常",
    );
    const handler = toolsSrc.slice(
      toolsSrc.indexOf("async function handleAnalyzePackageV2"),
      toolsSrc.indexOf("/* ══════════════════ Handler 注册表"),
    );
    ok(
      handler.indexOf("isEmptyAnalysisOutcome") <
        handler.indexOf("persistV2ForWorkforce"),
      "V2-SPINE-18c: 空壳判定在落库之前（空结果不留 canonical 痕迹）",
    );
  }

  /* ── 原子性：核心中途异常 → 由调用方事务回滚（异常必须外抛） ── */
  {
    const { tx, writes } = makeFakeTx({ row: ownedRow, throwOnWrite: 3 });
    let threw = "";
    try {
      await persistV2ForWorkforce({ ...wfArgs(), runFence: fakeFence(tx) });
    } catch (e) {
      threw = e instanceof Error ? e.message : "unknown";
    }
    ok(
      threw === "INJECTED_MIDWAY_FAILURE" &&
        !writes.some((w) => w.model === "tenderAnalysisRun" && w.op === "update"),
      "V2-SPINE-19: 中途异常向上抛出且 summaryJson 未写（事务边界回滚）",
      { threw },
    );
  }

  /* ── 核心自身不做任何 ownership 判定 ── */
  {
    // 只看**代码**：文件头的设计说明本来就要提到 lease/fence，
    // 拿注释当证据会把"写清楚了"误判成"做了这件事"。
    const coreCode = read("tender-auto-analysis/v2-persist-core.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    ok(
      !coreCode.includes("leaseOwner") &&
        !coreCode.includes("RunFence") &&
        !coreCode.includes("$transaction") &&
        !coreCode.includes("orgId"),
      "V2-SPINE-20: 核心零 lease / 零 fence / 零事务 / 零 org 判定（纯写入）",
      coreCode.match(/leaseOwner|RunFence|\$transaction|orgId/g),
    );
  }

  /* ── §9 长 await 租约心跳（HB-01..05） ── */
  {
    const { startLeaseHeartbeat } = await import(
      "@/lib/workforce-runtime/lease-heartbeat"
    );
    type Handle = { runId: string; leaseExpiresAt: Date; leaseMs: number };
    const LEASE_MS = 180_000;

    function makeRenew(behaviour: "ok" | "fail") {
      const calls: number[] = [];
      const fn = async (input: { lease: Handle }) => {
        calls.push(Date.now());
        if (behaviour === "fail") return { ok: false as const };
        return {
          ok: true as const,
          lease: {
            ...input.lease,
            leaseExpiresAt: new Date(
              input.lease.leaseExpiresAt.getTime() + LEASE_MS,
            ),
          },
        };
      };
      return { fn, calls };
    }

    // HB-01：tick 续租并推进 token
    {
      const r = makeRenew("ok");
      const hb = startLeaseHeartbeat({
        lease: {
          runId: "run",
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          leaseMs: LEASE_MS,
        },
        activeStatuses: ["running"],
        renew: r.fn as never,
        autoStart: false,
      });
      const before = hb.holder.lease.leaseExpiresAt.getTime();
      await hb.tick();
      ok(
        hb.renewals() === 1 &&
          hb.holder.lease.leaseExpiresAt.getTime() > before &&
          !hb.lost(),
        "HB-01: 心跳续租推进 fencing token（holder 同步更新）",
      );
      hb.stop();
    }

    // HB-02：续租失败 → lost，且不再重试（不伪造成功）
    {
      const r = makeRenew("fail");
      const hb = startLeaseHeartbeat({
        lease: {
          runId: "run",
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          leaseMs: LEASE_MS,
        },
        activeStatuses: ["running"],
        renew: r.fn as never,
        autoStart: false,
      });
      await hb.tick();
      await hb.tick();
      ok(
        hb.lost() && r.calls.length === 1 && hb.renewals() === 0,
        "HB-02: 续租失败即判 lost 并停止重试（后续 fence.guard 会正确 LostLeaseError）",
        { calls: r.calls.length },
      );
      hb.stop();
    }

    // HB-03：心跳与防栅栏写入互斥（消除 token 竞态）
    {
      const r = makeRenew("ok");
      const hb = startLeaseHeartbeat({
        lease: {
          runId: "run",
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          leaseMs: LEASE_MS,
        },
        activeStatuses: ["running"],
        renew: r.fn as never,
        autoStart: false,
      });
      const order: string[] = [];
      let release!: () => void;
      const blocked = new Promise<void>((res) => (release = res));
      const write = hb.holder.runExclusive!(async () => {
        order.push("write:start");
        await blocked;
        order.push("write:end");
      });
      const beat = hb.tick().then(() => order.push("renew"));
      await new Promise((res) => setTimeout(res, 5));
      const renewedDuringWrite = order.includes("renew");
      release();
      await Promise.all([write, beat]);
      ok(
        !renewedDuringWrite &&
          order.join(",") === "write:start,write:end,renew",
        "HB-03: 写入进行中心跳不续租（token 不会在 guard 断言途中被推进）",
        order,
      );
      hb.stop();
    }

    // HB-04：进入长事务前 TTL 不足 → 即时续租补满窗口
    {
      const r = makeRenew("ok");
      const hb = startLeaseHeartbeat({
        lease: {
          runId: "run",
          // 只剩 20s（< 50% 租约）：长事务 timeout 就有 120s，必须先补
          leaseExpiresAt: new Date(Date.now() + 20_000),
          leaseMs: LEASE_MS,
        },
        activeStatuses: ["running"],
        renew: r.fn as never,
        autoStart: false,
      });
      await hb.holder.runExclusive!(async () => undefined);
      ok(
        r.calls.length === 1 && hb.renewals() === 1,
        "HB-04: TTL 低于一半时进入临界区先即时续租",
      );
      hb.stop();
    }

    // HB-05：TTL 充足时零额外写
    {
      const r = makeRenew("ok");
      const hb = startLeaseHeartbeat({
        lease: {
          runId: "run",
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          leaseMs: LEASE_MS,
        },
        activeStatuses: ["running"],
        renew: r.fn as never,
        autoStart: false,
      });
      await hb.holder.runExclusive!(async () => undefined);
      ok(r.calls.length === 0, "HB-05: TTL 充足时临界区零额外续租写");
      hb.stop();
    }

    // HB-06：processor 真的把心跳接进了 slice 生命周期
    const procSrc = read("workforce-runtime/processor.ts");
    ok(
      procSrc.includes("startLeaseHeartbeat") &&
        procSrc.includes("heartbeat.stop()") &&
        procSrc.includes("const holder = heartbeat.holder"),
      "HB-06: processor 用心跳 holder 建 fence 并在 finally 停止心跳",
    );
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("异常：", e);
  process.exit(1);
});

void TenderV2LeaseLostError;
void persistV2CanonicalTx;
void WorkforceTenderDomainOwnershipError;
