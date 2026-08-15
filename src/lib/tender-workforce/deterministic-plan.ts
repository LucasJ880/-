/**
 * T5-P1 — Tender 确定性编排计划（server-authored DAG）
 *
 * 本文件**只描述 DAG**，绝不重写任何领域逻辑：
 * 每个 task 仍调用既有 tender_* 工具 → 既有领域服务
 * （V2 Grounding / Analyst / 证据校验 / addendum 优先级 / 包覆盖 / 风险 / 澄清）。
 * 这里没有一行解析 PDF、抽取条款或生成风险的代码——那些属于 Tender 领域，
 * 本模块属于编排。T5 架构法则：Workforce owns orchestration，Tender owns domain logic。
 *
 * 与既有 LLM 路径的唯一差别是**计划从哪来**：
 *   flag OFF → buildTenderAnalysisGoal() 散文 → LLM planner 重建 DAG（现状）
 *   flag ON  → 本文件直接产出同构 DAG（planner LLM 调用 = 0）
 * 产物、工具、领域服务、审批、handoff、lease/fence 全部不变。
 *
 * DAG 形状按当前代码实证（不按旧文档描述硬凑数量）：
 * 8 个 tender 工具（确定性白名单，不含 legacy extract）+ 1 个 native synthesis = 9 节点。
 *
 * Segment 3：语义来源收敛到 canonical V2。t3 一次产出全部包级语义，
 * t4/t5/t6 退化为**只读投影**，t7 物化 canonical 提交清单，
 * t8 只做 Job 级汇总，t9 只做状态终态化（不覆盖 canonical summaryJson）。
 *
 *   t1 validate_input（唯一根，无依赖）
 *     ├→ t2 parse_documents               (t1)
 *     ├→ t3 analyze_package_v2            (t1, t2)   ← 唯一语义来源
 *     ├→ t4 evidence_compliance（投影）    (t1, t3)
 *     ├→ t5 risk_analysis（投影）          (t1, t3, t4)
 *     ├→ t6 clarification_draft（投影）    (t1, t3)
 *     ├→ t7 build_deliverables（物化）     (t1, t3)
 *     └→ t8 synthesis  [synthesis_worker, 无 preferredTool]  (t2..t7)
 *          └→ t9 finalize_analysis        (t1, t3, t8)
 *
 * 关键实现约束（皆由审计确认，写错即被共享验证链拒绝）：
 * - `defaultWorkerKeyForTaskKind("work")` 返回 **sales_worker**，
 *   因此每个分析步骤必须**显式** workerKey: "tender_worker"，否则会被标成销售任务。
 * - synthesis 步骤：taskKind="synthesis"、无 preferredTool、requiresApproval=false、
 *   dependsOn 非空（applyWorkforceTaskSpecs 强制）。
 * - 全部步骤 executionMode="analysis" + requiresApproval=false：这些工具只产生
 *   机器分析记录，不发邮件/不建日历/不改客户数据（T5 §13：不为"测试审批"
 *   而人为把 tender 工具改成需审批）。
 * - resources 声明 project/tender 键：当前 tender 工具不在 v2 catalog 且未标
 *   parallelSafe → classifier 恒 SEQUENTIAL；声明 resources 是为 EXCLUSIVE_RESOURCE
 *   正确性与未来并行开启做准备（T5 §18：第一版优先安全顺序执行）。
 */

import {
  WORKFORCE_PLAN_CONTRACT_VERSION,
  type ServerAuthoredPlanV1,
  type ServerAuthoredTaskV1,
} from "@/lib/workforce-runtime/server-plan";

/**
 * Segment 3：语义来源从 legacy 抽取切到 canonical V2 包级分析，
 * 属重大语义变更 → bump 到 v2。与 workforce-plan/v1 无关（那是编排契约，不是一层）。
 */
export const TENDER_DETERMINISTIC_PLAN_VERSION = "tender-plan/v2" as const;

/** 与 tools.ts 注册名一一对应（写错即被工具白名单拒绝） */
const TOOL = {
  validate: "tender_validate_input",
  parse: "tender_parse_documents",
  analyzeV2: "tender_analyze_package_v2",
  compliance: "tender_evidence_compliance",
  risk: "tender_risk_analysis",
  clarification: "tender_clarification_draft",
  deliverables: "tender_build_deliverables",
  finalize: "tender_finalize_analysis",
} as const;

const TENDER_WORKER = "tender_worker";
const SYNTHESIS_WORKER = "synthesis_worker";

export type BuildTenderDeterministicPlanInput = {
  projectId: string;
  projectName: string;
  /** 可选：分析 run 标识（进 objective 文本，便于 Job Center 追溯） */
  analysisRunId?: string | null;
};

function analysisTask(
  input: Omit<ServerAuthoredTaskV1, "executionMode" | "riskLevel" | "requiresApproval" | "workerKey" | "taskKind"> & {
    riskLevel?: ServerAuthoredTaskV1["riskLevel"];
  },
): ServerAuthoredTaskV1 {
  return {
    ...input,
    workerKey: TENDER_WORKER,
    taskKind: "work",
    executionMode: "analysis",
    riskLevel: input.riskLevel ?? "MEDIUM",
    requiresApproval: false,
  };
}

/**
 * 构建 Tender 确定性计划。纯函数：同输入必得同输出（可用于影子对比与快照测试）。
 */
export function buildTenderDeterministicPlan(
  input: BuildTenderDeterministicPlanInput,
): ServerAuthoredPlanV1 {
  const name = input.projectName.slice(0, 80);
  const resources = [`project:${input.projectId}`, `tender:${input.projectId}`];

  const tasks: ServerAuthoredTaskV1[] = [
    analysisTask({
      id: "t1_validate_input",
      title: "校验输入并建立分析清单",
      description: `校验投标项目「${name}」的输入完整性，建立本次分析的文件清单与分析运行记录。`,
      dependsOn: [],
      preferredTool: TOOL.validate,
      expectedOutput: "分析清单（manifest）：本次纳入分析的文档集合与分析运行标识。",
      resources,
    }),
    analysisTask({
      id: "t2_parse_documents",
      title: "解析投标文件",
      description: "解析清单内的投标文件，落库页级文本，供后续抽取与证据引用使用。",
      dependsOn: ["t1_validate_input"],
      preferredTool: TOOL.parse,
      expectedOutput: "页级解析结果：各文档的可引用页文本已就绪。",
      resources,
    }),
    analysisTask({
      id: "t3_analyze_package_v2",
      title: "Canonical V2 包级分析",
      description:
        "对整个投标文件包运行 canonical V2 grounded 引擎，一次产出并原子落库全部包级语义："
        + "事实、要求、来源引用、澄清、风险与章节、冲突、补遗变更、提交清单、分析师结论。"
        + "这是本次分析**唯一**的语义来源；下游任务只做投影与物化，不再各自生成语义。",
      dependsOn: ["t1_validate_input", "t2_parse_documents"],
      preferredTool: TOOL.analyzeV2,
      expectedOutput:
        "canonical V2 已落库的计数与遥测（要求/事实/澄清/章节数、模型与调用次数）。",
      resources,
    }),
    analysisTask({
      id: "t4_evidence_compliance",
      title: "证据覆盖投影",
      description:
        "对 canonical 要求与来源引用做只读聚合统计（覆盖率、缺来源的强制要求）。"
        + "纯读：不重新抽取、不重新分类、零模型调用。",
      dependsOn: ["t1_validate_input", "t3_analyze_package_v2"],
      preferredTool: TOOL.compliance,
      riskLevel: "LOW",
      expectedOutput: "合规覆盖聚合：已覆盖/缺口要求分布。",
      resources,
    }),
    analysisTask({
      id: "t5_risk_analysis",
      title: "Canonical 风险投影",
      description:
        "读取 canonical V2 已生成的风险与冲突，校验形状后投影为结构化 Handoff。"
        + "不重新生成风险、不重新解释严重度、不写回 canonical 风险章节。",
      dependsOn: [
        "t1_validate_input",
        "t3_analyze_package_v2",
        "t4_evidence_compliance",
      ],
      preferredTool: TOOL.risk,
      expectedOutput: "风险章节：风险条目及其依据。",
      resources,
    }),
    analysisTask({
      id: "t6_clarification_draft",
      title: "Canonical 澄清投影",
      description:
        "读取 canonical V2 已生成的澄清问题并投影为 Handoff（仅草稿，绝不发送）。"
        + "不二次生成问题、不覆盖 canonical 澄清记录。",
      dependsOn: ["t1_validate_input", "t3_analyze_package_v2"],
      preferredTool: TOOL.clarification,
      expectedOutput: "澄清问题草稿列表。",
      resources,
    }),
    analysisTask({
      id: "t7_build_deliverables",
      title: "Grounded 交付物物化",
      description:
        "把 canonical summaryJson.submissionChecklist **逐条**物化为交付物记录"
        + "（1:1 投影，带要求编号与来源页码）。清单为空即产出 0 条，绝不回落静态模板。",
      dependsOn: ["t1_validate_input", "t3_analyze_package_v2"],
      preferredTool: TOOL.deliverables,
      expectedOutput: "交付物清单：每项可追溯到 requirementCode 与来源页码。",
      resources,
    }),
    {
      id: "t8_synthesis",
      title: "Workforce 执行汇总",
      description:
        "合并各上游任务的结构化 Handoff，产出 **Job 级**执行说明与结论。"
        + "这是编排层的汇总，不是 Tender 分析师结论——不产出也不写回任何 canonical 语义"
        + "（要求/风险/澄清/提交清单/分析师结论全部只属于 canonical V2 引擎）。",
      dependsOn: [
        "t2_parse_documents",
        "t3_analyze_package_v2",
        "t4_evidence_compliance",
        "t5_risk_analysis",
        "t6_clarification_draft",
        "t7_build_deliverables",
      ],
      // synthesis 由 runtime 原生执行：不设 preferredTool
      workerKey: SYNTHESIS_WORKER,
      taskKind: "synthesis",
      executionMode: "analysis",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput:
        "综合结论：summary / conclusions / recommendations / risks（供 finalize 消费）。",
      resources,
    },
    analysisTask({
      id: "t9_finalize_analysis",
      title: "Canonical V2 状态终态化",
      description:
        "确认 canonical V2 分析与 Job 级汇总均已完成，把分析运行从进行中推进到待人工审核。"
        + "只做状态转换：canonical summaryJson / summaryText 原样保留，不被执行摘要覆盖。",
      // §18：直接声明依赖 canonical V2 任务——finalize 模式由**上游执行证据**决定，
      // 不靠嗅探 summaryJson 形状猜。
      dependsOn: ["t1_validate_input", "t3_analyze_package_v2", "t8_synthesis"],
      preferredTool: TOOL.finalize,
      expectedOutput:
        "分析运行进入 REVIEW_REQUIRED，canonical V2 结果与摘要完整保留。",
      resources,
    }),
  ];

  return {
    contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
    objective: `对投标项目「${name}」执行一键 AI 投标分析（确定性编排）。`,
    summary:
      "服务端固定 DAG：校验输入 → 解析文件 → canonical V2 包级分析 → 证据/风险/澄清投影 + 交付物物化 → 执行汇总 → 状态终态化。",
    assumptions: [
      "编排由服务端确定；全部业务语义来自 canonical V2 引擎，编排层只投影不生成。",
      "全部步骤仅产生机器分析记录，不产生对外副作用。",
    ],
    // verificationType 必须与 verifier 实际可见的证据对齐。
    // 实测教训（隔离实库 E2E）：写成 database_state 时，verifier 只能看到 step 输出、
    // 无法查库，于是即便全部 step completed、TenderAnalysisRun 已达
    // REVIEW_REQUIRED，run 仍被判 verification_failed → needs_human。
    // 改为 tool_result：finalize / extract 的工具返回值就是可直接核验的证据。
    completionCriteria: [
      {
        id: "c1_canonical_v2_persisted",
        evidenceStepIds: ["t3_analyze_package_v2"],
        description:
          "tender_analyze_package_v2 返回 canonical V2 包级分析已原子落库（含要求/事实/澄清/章节计数）。",
        verificationType: "tool_result",
      },
      {
        id: "c2_deliverables_materialized",
        evidenceStepIds: ["t7_build_deliverables"],
        description:
          "tender_build_deliverables 返回交付物投影结果（0 条也是合法成功——验证投影过程正确完成，不是必须有交付物）。",
        verificationType: "tool_result",
      },
      {
        id: "c3_analysis_review_ready",
        evidenceStepIds: ["t9_finalize_analysis"],
        description:
          "tender_finalize_analysis 返回分析运行已终态化为待人工审核，且 canonical V2 结果原样保留。",
        verificationType: "tool_result",
      },
    ],
    tasks,
  };
}

/**
 * 计划语义阶段 → 任务 id（Segment 3 §23）。
 *
 * 影子对比的目标从"与 LLM 计划逐工具一致"改成"确定性 V2 阶段全覆盖"——
 * 两条路径现在**故意**语义不同：确定性走 canonical V2，回滚路径仍是旧 T1B 兼容。
 * 阶段名与任务 id 分离，因此用显式映射而不是字符串包含判断。
 */
export const TENDER_PLAN_STAGE_TASK_IDS = {
  validate_input: "t1_validate_input",
  parse_documents: "t2_parse_documents",
  canonical_v2: "t3_analyze_package_v2",
  evidence_projection: "t4_evidence_compliance",
  risk_projection: "t5_risk_analysis",
  clarification_projection: "t6_clarification_draft",
  deliverables: "t7_build_deliverables",
  synthesis: "t8_synthesis",
  finalize: "t9_finalize_analysis",
} as const;

export const TENDER_PLAN_SEMANTIC_STAGES = [
  "validate_input",
  "parse_documents",
  "canonical_v2",
  "evidence_projection",
  "risk_projection",
  "clarification_projection",
  "deliverables",
  "synthesis",
  "finalize",
] as const;
