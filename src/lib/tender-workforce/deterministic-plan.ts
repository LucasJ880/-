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
 * 8 个已注册 tender 工具 + 1 个 native synthesis = 9 节点。
 * （T5-P1 parity closure：新增 t7_build_deliverables——审计确认 legacy 的
 *   BUILD_DELIVERABLES 在 V2 下已刻意停用静态模板，grounded 替代品从真实要求派生，
 *   因此本节点依赖 t3_extract_requirements，并被 synthesis 消费。）
 *
 *   t1 validate_input（唯一根，无依赖）
 *     ├→ t2 parse_documents            (t1)
 *     ├→ t3 extract_requirements       (t1, t2)
 *     ├→ t4 evidence_compliance        (t1, t3)
 *     ├→ t5 risk_analysis              (t1, t3, t4)
 *     ├→ t6 clarification_draft        (t1, t3)
 *     ├→ t7 build_deliverables         (t1, t3)
 *     └→ t8 synthesis  [synthesis_worker, 无 preferredTool]  (t2..t7)
 *          └→ t9 finalize_analysis     (t1, t8)
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

export const TENDER_DETERMINISTIC_PLAN_VERSION = "tender-plan/v1" as const;

/** 与 tools.ts 注册名一一对应（写错即被工具白名单拒绝） */
const TOOL = {
  validate: "tender_validate_input",
  parse: "tender_parse_documents",
  extract: "tender_extract_requirements",
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
      id: "t3_extract_requirements",
      title: "提取要求与报告章节",
      description:
        "基于页级文本提取招标要求与报告章节（走既有 V2 grounding / 抽取服务，不在编排层复制逻辑）。",
      dependsOn: ["t1_validate_input", "t2_parse_documents"],
      preferredTool: TOOL.extract,
      expectedOutput: "结构化要求清单与报告章节，均带来源页码。",
      resources,
    }),
    analysisTask({
      id: "t4_evidence_compliance",
      title: "证据与合规覆盖分析",
      description: "统计要求的证据覆盖与合规聚合（只读聚合，不改写抽取结果）。",
      dependsOn: ["t1_validate_input", "t3_extract_requirements"],
      preferredTool: TOOL.compliance,
      riskLevel: "LOW",
      expectedOutput: "合规覆盖聚合：已覆盖/缺口要求分布。",
      resources,
    }),
    analysisTask({
      id: "t5_risk_analysis",
      title: "风险分析",
      description: "基于要求与覆盖情况生成风险与废标风险条目（既有风险服务）。",
      dependsOn: [
        "t1_validate_input",
        "t3_extract_requirements",
        "t4_evidence_compliance",
      ],
      preferredTool: TOOL.risk,
      expectedOutput: "风险章节：风险条目及其依据。",
      resources,
    }),
    analysisTask({
      id: "t6_clarification_draft",
      title: "澄清问题草稿",
      description: "生成澄清问题草稿（仅草稿，绝不发送——发送属人工动作）。",
      dependsOn: ["t1_validate_input", "t3_extract_requirements"],
      preferredTool: TOOL.clarification,
      expectedOutput: "澄清问题草稿列表。",
      resources,
    }),
    analysisTask({
      id: "t7_build_deliverables",
      title: "生成交付物清单",
      description:
        "从本次抽取的强制要求派生投标交付物清单（提交类/需证据的要求 → 交付物，带要求编号与来源页码）。",
      dependsOn: ["t1_validate_input", "t3_extract_requirements"],
      preferredTool: TOOL.deliverables,
      expectedOutput: "交付物清单：每项可追溯到 requirementCode 与来源页码。",
      resources,
    }),
    {
      id: "t8_synthesis",
      title: "综合汇总",
      description:
        "合并解析、要求、合规、风险、澄清各上游任务的结构化 Handoff，产出综合结论。",
      dependsOn: [
        "t2_parse_documents",
        "t3_extract_requirements",
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
      title: "写回最终分析结果",
      description:
        "消费综合结论，写回 canonical 分析结果并将分析运行推进到待人工审核状态。",
      dependsOn: ["t1_validate_input", "t8_synthesis"],
      preferredTool: TOOL.finalize,
      expectedOutput: "canonical 分析结果已写回，运行进入 REVIEW_REQUIRED。",
      resources,
    }),
  ];

  return {
    contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
    objective: `对投标项目「${name}」执行一键 AI 投标分析（确定性编排）。`,
    summary:
      "服务端固定 DAG：校验输入 → 解析文件 → 提取要求 → 证据合规 → 风险 → 澄清 → 交付物 → 综合 → 写回结果。",
    assumptions: [
      "编排由服务端确定；领域判断仍由既有 Tender 服务与模型完成。",
      "全部步骤仅产生机器分析记录，不产生对外副作用。",
    ],
    // verificationType 必须与 verifier 实际可见的证据对齐。
    // 实测教训（隔离实库 E2E）：写成 database_state 时，verifier 只能看到 step 输出、
    // 无法查库，于是即便全部 step completed、TenderAnalysisRun 已达
    // REVIEW_REQUIRED，run 仍被判 verification_failed → needs_human。
    // 改为 tool_result：finalize / extract 的工具返回值就是可直接核验的证据。
    completionCriteria: [
      {
        id: "c1_analysis_persisted",
        description:
          "tender_finalize_analysis 返回成功写回 canonical 分析结果，并将分析运行推进到待人工审核状态。",
        verificationType: "tool_result",
      },
      {
        id: "c2_requirements_extracted",
        description:
          "tender_extract_requirements 返回带来源页码的招标要求与报告章节。",
        verificationType: "tool_result",
      },
    ],
    tasks,
  };
}

/** 计划语义阶段（影子对比用：比较语义阶段覆盖而非逐字节相同） */
export const TENDER_PLAN_SEMANTIC_STAGES = [
  "validate_input",
  "parse_documents",
  "extract_requirements",
  "evidence_compliance",
  "risk_analysis",
  "clarification_draft",
  "build_deliverables",
  "synthesis",
  "finalize_analysis",
] as const;
