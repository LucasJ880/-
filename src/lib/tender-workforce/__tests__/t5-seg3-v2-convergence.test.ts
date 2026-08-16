/**
 * T5-P1 Segment 3 — 确定性 DAG canonical V2 收敛（纯平面，零 DB / 零 LLM）
 *
 * V2-CONV-01..16 + 单一语义源不变量（§24）：
 * 确定性路径的全部业务语义只来自 canonical V2 引擎，Workforce 侧只投影/物化。
 *
 * 运行：npx tsx src/lib/tender-workforce/__tests__/t5-seg3-v2-convergence.test.ts
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  buildTenderDeterministicPlan,
  TENDER_DETERMINISTIC_PLAN_VERSION,
  TENDER_PLAN_SEMANTIC_STAGES,
  TENDER_PLAN_STAGE_TASK_IDS,
} from "../deterministic-plan";
import {
  findCanonicalV2Evidence,
  TENDER_CANONICAL_V2_MARKER,
  TENDER_SEMANTIC_ENGINE_V2,
  TENDER_WORKFORCE_TOOL_NAMES,
  TENDER_WORKFORCE_PLANNER_TOOL_NAMES,
  TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES,
  tenderWorkforcePlannerTools,
  tenderWorkforceDeterministicTools,
} from "../tools";
import { buildTenderAnalysisGoal } from "../trigger-service";
import { compileServerAuthoredPlan } from "@/lib/workforce-runtime/plan-compile";
import { plannerVisibleRuntimeV2Tools } from "@/lib/agent-runtime-v2/tool-catalog";

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
/** 去注释后的代码（源码级断言只看代码，不把设计说明当证据） */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const PLAN_INPUT = {
  projectId: "proj_seg3",
  projectName: "Seg3 测试项目",
  analysisRunId: "run_seg3",
};
const plan = buildTenderDeterministicPlan(PLAN_INPUT);
const taskById = new Map(plan.tasks.map((t) => [t.id, t]));
const toolsCode = code("tender-workforce/tools.ts");

console.log("T5 Segment 3 — 确定性 DAG canonical V2 收敛");

/* ── V2-CONV-01 / 02：DAG 语义来源 ── */
ok(
  taskById.get("t3_analyze_package_v2")?.preferredTool ===
    "tender_analyze_package_v2",
  "V2-CONV-01: 确定性 DAG 的 t3 使用 tender_analyze_package_v2",
);
ok(
  plan.tasks.every((t) => t.preferredTool !== "tender_extract_requirements") &&
    !plan.tasks.some((t) => t.id === "t3_extract_requirements"),
  "V2-CONV-02: legacy tender_extract_requirements 不出现在确定性 DAG",
  plan.tasks.map((t) => t.preferredTool),
);
ok(
  plan.tasks.length === 9 &&
    TENDER_DETERMINISTIC_PLAN_VERSION === "tender-plan/v2",
  "V2-CONV-01b: 9 个任务，计划语义版本 bump 到 tender-plan/v2",
  { count: plan.tasks.length, version: TENDER_DETERMINISTIC_PLAN_VERSION },
);

/* ── V2-CONV-03：风险投影零模型调用 ── */
{
  const riskV2Branch = toolsCode.slice(
    toolsCode.indexOf("async function handleRiskAnalysis"),
    toolsCode.indexOf("async function handleClarificationDraft"),
  );
  const canonicalBranch = riskV2Branch.slice(
    riskV2Branch.indexOf("const canonicalV2 = findCanonicalV2Evidence"),
    riskV2Branch.indexOf("const systemPrompt"),
  );
  ok(
    canonicalBranch.length > 0 &&
      !canonicalBranch.includes("createCompletion") &&
      !canonicalBranch.includes("riskModelOverrideForTests"),
    "V2-CONV-03: canonical 风险投影分支零模型调用",
  );
  ok(
    !canonicalBranch.includes("upsertWorkforceRiskSection") &&
      !canonicalBranch.includes("tenderAnalysisSection.upsert") &&
      !canonicalBranch.includes(".update("),
    "V2-CONV-03b: canonical 风险投影零 canonical 写（不覆盖 RISKS 章节）",
  );
  ok(
    canonicalBranch.includes("readCanonicalV2Risks") &&
      canonicalBranch.includes('sectionKey: "RISKS"'),
    "V2-CONV-03c: 从 canonical RISKS 章节读取并校验形状（审计确认的存放位置）",
  );
}

/* ── V2-CONV-04：澄清投影零二次生成 ── */
{
  const clarBranch = toolsCode.slice(
    toolsCode.indexOf("async function handleClarificationDraft"),
    toolsCode.indexOf("async function handleBuildDeliverables"),
  );
  const canonicalPart = clarBranch.slice(
    clarBranch.indexOf("const canonicalV2 = findCanonicalV2Evidence"),
    clarBranch.indexOf("const built = await buildClarifications"),
  );
  ok(
    canonicalPart.length > 0 &&
      !canonicalPart.includes("buildClarifications") &&
      !canonicalPart.includes("createCompletion"),
    "V2-CONV-04: canonical 澄清投影不调用 buildClarifications、不二次生成",
  );
  ok(
    !canonicalPart.includes(".create(") &&
      !canonicalPart.includes(".update(") &&
      !canonicalPart.includes(".upsert("),
    "V2-CONV-04b: canonical 澄清投影零写（不覆盖 canonical 澄清记录）",
  );
}

/* ── V2-CONV-05：finalize 走 canonical 状态终态化 ── */
{
  const finalizeBranch = toolsCode.slice(
    toolsCode.indexOf("async function handleFinalizeAnalysis"),
  );
  const canonicalPart = finalizeBranch.slice(
    finalizeBranch.indexOf("const canonicalV2 = findCanonicalV2Evidence"),
    finalizeBranch.indexOf("const aggregate = await computeComplianceAggregate"),
  );
  ok(
    canonicalPart.includes("finalizeWorkforceTenderCanonicalV2Run"),
    "V2-CONV-05: canonical 模式调用 status-only finalize",
  );
  ok(
    !canonicalPart.includes("TENDER_ANALYSIS_RESULT_VERSION") &&
      !canonicalPart.includes("summaryText") &&
      !canonicalPart.includes("finalizeWorkforceTenderAnalysisRun("),
    "V2-CONV-06: canonical 模式不构造 V1 结果、不写 summaryText（CANONICAL_SUMMARY_OVERWRITE = 0）",
  );
  // Segment 1 已实证：canonical finalize 的 update 只含状态字段
  const svcCode = code("tender-workforce/analysis-run-service.ts");
  const fn = svcCode.slice(
    svcCode.indexOf("export async function finalizeWorkforceTenderCanonicalV2Run"),
    svcCode.indexOf("export async function finalizeWorkforceTenderAnalysisRun"),
  );
  ok(
    fn.length > 0 && !fn.includes("summaryJson") && !fn.includes("summaryText"),
    "V2-CONV-07/08/09: summaryJson / submissionChecklist / analystSynthesis / brief 均不在写入面（原样保留）",
  );
}

/* ── V2-CONV-10..13：三层工具面 ── */
ok(
  tenderWorkforceDeterministicTools().some(
    (t) => t.name === "tender_analyze_package_v2",
  ) && TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES.length === 8,
  "V2-CONV-10: 确定性 planTools 含 canonical V2 工具（共 8 个）",
);
ok(
  !tenderWorkforcePlannerTools().some(
    (t) => t.name === "tender_analyze_package_v2",
  ),
  "V2-CONV-11: LLM planner 面不含 canonical V2 工具",
);
ok(
  !tenderWorkforcePlannerTools().some(
    (t) => t.name === "tender_build_deliverables",
  ) && TENDER_WORKFORCE_PLANNER_TOOL_NAMES.length === 7,
  "V2-CONV-12: LLM planner 面不含 grounded 交付物工具（共 7 个，回滚基线）",
);
ok(
  !plannerVisibleRuntimeV2Tools().some((t) => t.name.startsWith("tender_")),
  "V2-CONV-13: 全局 planner 投影的 tender 工具数 = 0",
);
ok(
  TENDER_WORKFORCE_TOOL_NAMES.length === 9,
  "V2-CONV-13b: 可执行集合 9（EXECUTABLE ⊋ 两个投影面）",
);

/* ── V2-CONV-14：finalize 直接依赖 canonical V2 证据 ── */
{
  const t9 = taskById.get("t9_finalize_analysis");
  ok(
    (t9?.dependsOn ?? []).includes("t3_analyze_package_v2") &&
      (t9?.dependsOn ?? []).includes("t8_synthesis"),
    "V2-CONV-14: t9 同时直接依赖 canonical V2 与 synthesis（模式由证据决定，不猜）",
    t9?.dependsOn,
  );
  const finalizeBranch = toolsCode.slice(
    toolsCode.indexOf("async function handleFinalizeAnalysis"),
  );
  ok(
    finalizeBranch.includes("findCanonicalV2Evidence(ctx.priorEvidence)") &&
      !finalizeBranch.includes("submissionChecklist"),
    "V2-CONV-14b: finalize 模式由声明依赖的执行证据决定，不嗅探 summaryJson 形状",
  );
}

/* ── V2-CONV-15：synthesis 不写 canonical ── */
{
  const synthCode = code("workforce-runtime/synthesis.ts");
  const canonicalWriteMarkers = [
    "tenderExtractedRequirement",
    "tenderAnalysisSection",
    "tenderClarificationQuestion",
    "tenderAnalysisFact",
    "tenderAnalysisRun",
    "summaryJson",
  ];
  ok(
    canonicalWriteMarkers.every((m) => !synthCode.includes(m)),
    "V2-CONV-15: native synthesis 零 canonical 写（WORKFORCE_SYNTHESIS_CANONICAL_WRITES = 0）",
    canonicalWriteMarkers.filter((m) => synthCode.includes(m)),
  );
  const t8 = taskById.get("t8_synthesis");
  ok(
    !t8?.preferredTool && t8?.taskKind === "synthesis",
    "V2-CONV-15b: t8 仍是 runtime 原生 synthesis（无工具、无域写入通道）",
  );
}

/* ── V2-CONV-16：完成标准全部确定性且证据可达 ── */
{
  const criteria = plan.completionCriteria;
  const ids = new Set(plan.tasks.map((t) => t.id));
  ok(
    criteria.length === 3 &&
      criteria.every((c) => c.verificationType === "tool_result"),
    "V2-CONV-16: 三条完成标准全部 tool_result（VERIFIER_MODEL_CALLS = 0）",
    criteria.map((c) => c.verificationType),
  );
  ok(
    criteria.every(
      (c) =>
        (c.evidenceStepIds ?? []).length > 0 &&
        (c.evidenceStepIds ?? []).every((id) => ids.has(id)),
    ),
    "V2-CONV-16b: 每条标准都绑定存在的证据任务",
    criteria.map((c) => c.evidenceStepIds),
  );
  ok(
    criteria.map((c) => c.evidenceStepIds?.[0]).join(",") ===
      "t3_analyze_package_v2,t7_build_deliverables,t9_finalize_analysis",
    "V2-CONV-16c: 标准绑定 canonical 落库 / 交付物物化 / 终态化三个确定性证据",
  );
}

/* ── 计划可编译（确定性白名单下穿过共享验证链） ── */
{
  const compiled = compileServerAuthoredPlan({
    plan,
    tools: tenderWorkforceDeterministicTools(),
    maxSteps: 9,
  });
  ok(compiled.ok, "PLAN-COMPILE: 确定性 V2 计划通过共享验证链", compiled);
  const tooSmall = compileServerAuthoredPlan({
    plan,
    tools: tenderWorkforceDeterministicTools(),
    maxSteps: 8,
  });
  ok(
    !tooSmall.ok && tooSmall.code === "SERVER_PLAN_EXCEEDS_MAX_STEPS",
    "PLAN-MAXSTEPS: 上限不足时 fail-closed，绝不静默截断（§29）",
    tooSmall,
  );
  const wrongTools = compileServerAuthoredPlan({
    plan,
    tools: tenderWorkforcePlannerTools(),
    maxSteps: 9,
  });
  ok(
    wrongTools.ok === false ||
      (wrongTools.ok &&
        wrongTools.compiled.plan.steps.some(
          (s) => s.preferredTool === undefined,
        )),
    "PLAN-SCOPE: 用 LLM 兼容白名单编译确定性计划无法保留 canonical V2 工具",
  );
}

/* ── §10：模式解析只认声明依赖里的 server marker ── */
{
  const marker = {
    [TENDER_CANONICAL_V2_MARKER]: true,
    semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
    canonicalPersisted: true,
    analysisRunId: "run_seg3",
  };
  ok(
    findCanonicalV2Evidence({ s3: marker })?.analysisRunId === "run_seg3",
    "MODE-01: 上游 marker 完整 → 识别为 canonical V2 模式",
  );
  ok(
    findCanonicalV2Evidence({}) === null &&
      findCanonicalV2Evidence({ s3: { ...marker, canonicalPersisted: false } }) ===
        null &&
      findCanonicalV2Evidence({
        s3: { ...marker, semanticEngine: "something-else" },
      }) === null,
    "MODE-02: marker 缺失/不完整 → 兼容模式（不猜）",
  );
  ok(
    findCanonicalV2Evidence({
      s3: { tenderExtract: true, analysisRunId: "run_seg3" },
    }) === null,
    "MODE-03: legacy 抽取证据不会被误判为 canonical V2",
  );
  const marks = toolsCode.match(/findCanonicalV2Evidence\(ctx\.priorEvidence\)/g);
  ok(
    (marks?.length ?? 0) === 4,
    "MODE-04: 四个下游工具（证据/风险/澄清/终态化）都按声明证据判模式",
    marks?.length,
  );
  // tools.ts 里仅有的 process.env 用法是测试桩闸门（NODE_ENV !== "test" → 关闭），
  // 不是语义分支。真正要排除的是"编排 flag 参与工具语义判定"。
  const envUses = toolsCode.match(/process\.env\.\w+/g) ?? [];
  ok(
    !toolsCode.includes("isTenderWorkforceDeterministicPlanEnabled") &&
      !toolsCode.includes('from "./flags"') &&
      !toolsCode.includes("workforce-runtime/flags") &&
      envUses.every((u) => u === "process.env.NODE_ENV"),
    "MODE-05: 工具语义不由编排 flag 决定（仅存的 env 用法是测试桩闸门）",
    envUses,
  );
}

/* ── §24：单一语义源不变量 ── */
{
  // 需求 / 提交清单分类：只有 canonical V2 引擎产出；Workforce 侧零分类
  const delivCode = code("tender-auto-analysis/deliverables.ts");
  ok(
    delivCode.includes("readCanonicalSubmissionChecklist") &&
      !delivCode.includes("createCompletion"),
    "SEMANTIC-01: V2_SUBMISSION_CLASSIFIERS = 1（交付物只投影 canonical 清单）",
  );
  // 确定性路径下 Workforce 工具零 LLM 语义生成
  const detCode = code("tender-workforce/deterministic-plan.ts");
  ok(
    !detCode.includes("tender_extract_requirements"),
    "SEMANTIC-02: V2_REQUIREMENT_SEMANTIC_GENERATORS = 1（确定性路径无第二套抽取）",
  );
  // 风险：canonical 分支不生成；生成分支只在兼容路径
  const riskCanonicalFirst =
    toolsCode.indexOf("const canonicalV2 = findCanonicalV2Evidence", toolsCode.indexOf("async function handleRiskAnalysis")) <
    toolsCode.indexOf("const systemPrompt");
  ok(
    riskCanonicalFirst,
    "SEMANTIC-03: V2_RISK_SEMANTIC_GENERATORS = 1（canonical 分支先返回，模型分支仅兼容路径可达）",
  );
  const clarCanonicalFirst =
    toolsCode.indexOf(
      "const canonicalV2 = findCanonicalV2Evidence",
      toolsCode.indexOf("async function handleClarificationDraft"),
    ) < toolsCode.indexOf("const built = await buildClarifications");
  ok(
    clarCanonicalFirst,
    "SEMANTIC-04: V2_CLARIFICATION_SEMANTIC_GENERATORS = 1",
  );
  // 分析师结论只有一个产出点。**不锁死在具体文件**——#113 把 analyst 合成
  // 从 v2-persist.ts 挪进了分片执行器 v2-resumable.ts，位置会变、不变量不变。
  // 因此改成全树扫描：整个 canonical V2 域里，写 summaryJson.analystSynthesis
  // 的地方必须恰好一处，且不得出现在 Workforce 工具层。
  const writers = execSync(
    `grep -rn "summaryJson.analystSynthesis[[:space:]]*=" ${JSON.stringify(ROOT)} || true`,
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.includes("__tests__"));
  ok(
    writers.length === 1 && !toolsCode.includes("analystSynthesis"),
    "SEMANTIC-05: V2_ANALYST_SYNTHESIS_GENERATORS = 1（全树唯一写入点，且不在 Workforce 工具层）",
    writers.map((w) => w.replace(`${ROOT}/`, "").split(":").slice(0, 2).join(":")),
  );
}

/* ── §5：兼容路径 goal 不再诱导调用交付物工具 ── */
{
  const goal = buildTenderAnalysisGoal("测试项目");
  ok(
    !goal.includes("交付物") && !goal.includes("canonical"),
    "GOAL-01: flag OFF 的 LLM goal 恢复 T1B 基线（不要求交付物 / canonical V2）",
  );
  const stages = goal.match(/→/g)?.length ?? 0;
  ok(
    stages === 7 && goal.includes("tender_finalize_analysis"),
    "GOAL-02: 兼容 goal 保持 8 步基线流程",
    stages,
  );
}

/* ── §23：阶段覆盖 + 回滚面完整 ── */
{
  const ids = new Set(plan.tasks.map((t) => t.id));
  ok(
    TENDER_PLAN_SEMANTIC_STAGES.every((s) =>
      ids.has(TENDER_PLAN_STAGE_TASK_IDS[s]),
    ),
    "STAGE-01: DETERMINISTIC_V2_STAGE_COVERAGE = PASS",
  );
  const compat = tenderWorkforcePlannerTools().map((t) => t.name).sort();
  ok(
    JSON.stringify(compat) ===
      JSON.stringify(
        [
          "tender_clarification_draft",
          "tender_evidence_compliance",
          "tender_extract_requirements",
          "tender_finalize_analysis",
          "tender_parse_documents",
          "tender_risk_analysis",
          "tender_validate_input",
        ].sort(),
      ),
    "STAGE-02: FLAG_OFF_LLM_COMPATIBILITY = PASS（回滚面 = T1B 基线七件套）",
    compat,
  );
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
