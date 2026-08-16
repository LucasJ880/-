/**
 * Tender T1B — Workforce Tool 层（任务书 §12/§13/§14/§24）
 *
 * 七个 tender 分析工具：descriptor（planner 白名单投影）+ handler
 * （注册进 agent-runtime-v2 authoritative handler map）。
 *
 * 关键边界：
 * - 工具刻意**不进** RUNTIME_V2_TOOL_CATALOG：全局 planner 投影
 *   （catalog ∩ executable）保持 13 个销售线工具不变，legacy runtime_v2
 *   与 sales workforce 计划面零暴露（EXECUTABLE ⊋ PLANNER_VISIBLE 是
 *   #88 明确允许的方向）。tender job 由 processor 经
 *   resolveWorkforcePlannerToolsForJob 注入本白名单（§12 MINIMUM TOOL
 *   SCOPE：planner sanitize 强制 preferredTool ⊆ 白名单，email/calendar/
 *   sales 写工具在 tender job 计划里结构性不可达）。
 * - 每个 handler 执行期自证上下文（§35 双保险第二层）：runId → AgentRun
 *   （org 域内）→ metadata.workDomain === "tender" ∧ projectId 存在，
 *   否则 fail-closed——即使某天工具被计划进非 tender run 也拒绝执行。
 * - 业务写入全部走 tender-auto-analysis 共享 service / 本模块薄适配层，
 *   handler 不散落业务规则（§24）。
 * - 证据消费按 #89 语义形状识别（不读黄金 stepKey 字面量）。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import type {
  AdapterContext,
  AdapterResult,
} from "@/lib/agent-runtime-v2/adapters";
import type { ToolDescriptor } from "@/lib/agent-runtime-v2/schemas";
import { parseDocumentPagesAndStore } from "@/lib/tender-auto-analysis/page-parse";
import {
  extractFromPages,
  extractRequirements,
} from "@/lib/tender-auto-analysis/extract";
import { generateReportSections } from "@/lib/tender-auto-analysis/report";
import { buildClarifications } from "@/lib/tender-auto-analysis/clarifications";
import { buildGroundedDeliverables } from "@/lib/tender-auto-analysis/deliverables";
import {
  isEmptyAnalysisOutcome,
  runV2Inference,
} from "@/lib/tender-auto-analysis/v2-persist";
import { persistV2ForWorkforce } from "./v2-persist-workforce";
import {
  createOrReuseWorkforceTenderAnalysisRun,
  failWorkforceTenderAnalysisRun,
  finalizeWorkforceTenderAnalysisRun,
  finalizeWorkforceTenderCanonicalV2Run,
  requireWorkforceTenderRun,
  upsertWorkforceRiskSection,
  type TenderAnalysisInputManifest,
} from "./analysis-run-service";
import {
  TENDER_ANALYSIS_RESULT_VERSION,
  TenderRiskItemSchema,
  type TenderAnalysisResultV1,
  type TenderRiskItem,
} from "./result-contract";
import { z } from "zod";

/** 与 adapters.ts 内部 RuntimeV2ToolHandler 结构一致（structural typing） */
type TenderToolHandler = (ctx: AdapterContext) => Promise<AdapterResult>;

/* ══════════════════ 工具白名单 descriptor（§12） ══════════════════ */

export const TENDER_WORKFORCE_TOOL_NAMES = [
  "tender_validate_input",
  "tender_parse_documents",
  "tender_extract_requirements",
  "tender_evidence_compliance",
  "tender_risk_analysis",
  "tender_clarification_draft",
  "tender_build_deliverables",
  "tender_finalize_analysis",
  // T5-P1 Segment 2：canonical V2 能力（**可执行但当前 planner 不可见**，见下）
  "tender_analyze_package_v2",
] as const;

export type TenderWorkforceToolName =
  (typeof TENDER_WORKFORCE_TOOL_NAMES)[number];

/**
 * T5-P1 Segment 2 §15 —— **planner 可见性 ⊊ 可执行集合**。
 *
 * `tender_analyze_package_v2` 已具备完整执行 descriptor 与 handler（可被
 * server/runtime 测试执行），但**不在**本列表中：当前 deterministic DAG 走的仍是
 * legacy 语义抽取（t3），提前让 planner 看见它只会造出"半迁移"计划。
 * 接线属 Segment 3，本段不改变任何用户可见行为。
 */
export const TENDER_WORKFORCE_PLANNER_TOOL_NAMES = [
  "tender_validate_input",
  "tender_parse_documents",
  "tender_extract_requirements",
  "tender_evidence_compliance",
  "tender_risk_analysis",
  "tender_clarification_draft",
  "tender_finalize_analysis",
] as const satisfies readonly TenderWorkforceToolName[];

/**
 * Segment 3 §2C —— **确定性 V2 编排**允许的工具集合。
 *
 * 与 LLM 兼容面的差别是语义来源，不是"多几个工具"：
 *   canonical V2 走 tender_analyze_package_v2 一次产出全部包级语义，
 *   因此这里**不含** legacy tender_extract_requirements——两套抽取共存
 *   就是两套 Tender 真相。
 * 反过来 tender_build_deliverables 只在这里出现：它严格投影
 * summaryJson.submissionChecklist，而 legacy 抽取路径根本不产出该字段。
 */
export const TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES = [
  "tender_validate_input",
  "tender_parse_documents",
  "tender_analyze_package_v2",
  "tender_evidence_compliance",
  "tender_risk_analysis",
  "tender_clarification_draft",
  "tender_build_deliverables",
  "tender_finalize_analysis",
] as const satisfies readonly TenderWorkforceToolName[];

/**
 * Tender Analysis Allowlist：planner 只能看到这 7 个工具（+native
 * synthesis 语义）。全部 requiresApproval=false——它们只产生机器分析
 * 产物（与 legacy tender-auto-analysis 同信任级），不做任何业务承诺
 * 动作（§28：无 email/calendar/GO/NO-GO/Lock/Submit）。
 * 刻意不标 parallelSafe：2B-2 classifier 对未标注/无 catalog descriptor
 * 的工具恒 SEQUENTIAL（本阶段建立顺序基线，§30）。
 */
export const TENDER_WORKFORCE_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: "tender_validate_input",
    description:
      "第一步（无依赖）：分析投标项目输入是否齐备并产出分析清单（文件包、指纹、addendum）。纯分析步骤：executionMode=analysis、requiresApproval=false（机器分析记录，不是业务写操作）；输出 analysisRunId 与文档清单，供全部后续任务依赖",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_parse_documents",
    description:
      "解析清单中的投标文件为逐页文本（幂等，已解析的跳过）。纯分析步骤：executionMode=analysis、requiresApproval=false；依赖 tender_validate_input",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_extract_requirements",
    description:
      "从已解析页面提取投标要求/事实/来源引用并生成报告章节（复用既有提取管线）。纯分析步骤：executionMode=analysis、requiresApproval=false；依赖 tender_validate_input 与 tender_parse_documents",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_evidence_compliance",
    description:
      "只读分析：统计要求的证据覆盖与合规缺口（强制/需证据/来源挂钩/缺失信息）。executionMode=analysis、requiresApproval=false；依赖 tender_extract_requirements",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_risk_analysis",
    description:
      "基于已提取要求与事实做投标风险分析（CRITICAL/HIGH/MEDIUM/INFORMATIONAL，逐条给来源）。纯分析步骤：executionMode=analysis、requiresApproval=false；依赖 tender_extract_requirements 与 tender_evidence_compliance",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_clarification_draft",
    description:
      "生成澄清问题草稿（仅草稿，绝不发送；文档已明确回答的不生成）。纯分析步骤：executionMode=analysis、requiresApproval=false；依赖 tender_extract_requirements",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_build_deliverables",
    description:
      "从本次真实抽取的强制要求派生投标交付物清单（提交类/需证据的要求 → 交付物，带 requirementCode 与来源页码）。纯派生、零 LLM、幂等；不套固定模板——没有对应要求就不产出交付物。纯分析步骤：executionMode=analysis、requiresApproval=false；依赖 tender_extract_requirements",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    name: "tender_finalize_analysis",
    description:
      "最后一步：把综合结论与域内统计组装为最终分析结果，供人工审阅。纯分析步骤：executionMode=analysis、requiresApproval=false（产出机器分析记录，人工审阅在系统内另行进行，不是本流程的审批动作）；必须依赖综合汇总（synthesis）任务",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
  {
    // T5-P1 Segment 2：执行策略 descriptor 必须存在（未知 descriptor 一律
    // fail-closed，见 workforce-runtime/execution-descriptor.ts），
    // 但该工具不进 planner 投影（TENDER_WORKFORCE_PLANNER_TOOL_NAMES）。
    name: "tender_analyze_package_v2",
    description:
      "对整个投标文件包运行 canonical V2 grounded 分析引擎，并以 Workforce 执行权防栅栏原子落库（事实/要求/来源引用/澄清/变更/章节/summaryJson）。纯分析步骤：executionMode=analysis、requiresApproval=false；不改变分析记录状态（终态化是另一步）",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: false,
    supportedChannels: ["web"],
  },
];

const PLANNER_VISIBLE = new Set<string>(TENDER_WORKFORCE_PLANNER_TOOL_NAMES);
const DETERMINISTIC_VISIBLE = new Set<string>(
  TENDER_WORKFORCE_DETERMINISTIC_TOOL_NAMES,
);

/**
 * planner 投影 = descriptor ∩ planner 白名单。
 * 执行注册（TENDER_WORKFORCE_TOOL_HANDLERS）与执行策略
 * （TENDER_WORKFORCE_TOOL_DESCRIPTORS）覆盖更大集合——EXECUTABLE ⊋ PLANNER_VISIBLE。
 */
export function tenderWorkforcePlannerTools(): ToolDescriptor[] {
  return TENDER_WORKFORCE_TOOL_DESCRIPTORS.filter((d) =>
    PLANNER_VISIBLE.has(d.name),
  ).map((d) => ({ ...d }));
}

/** 确定性 V2 计划的工具白名单（server-authored plan 编译用；不进 planner 提示词） */
export function tenderWorkforceDeterministicTools(): ToolDescriptor[] {
  return TENDER_WORKFORCE_TOOL_DESCRIPTORS.filter((d) =>
    DETERMINISTIC_VISIBLE.has(d.name),
  ).map((d) => ({ ...d }));
}

/* ══════════════════ 执行期上下文自证（§35 第二层） ══════════════════ */

type TenderJobContext = {
  jobId: string;
  projectId: string;
};

async function requireTenderJobContext(
  ctx: AdapterContext,
): Promise<{ ok: true; job: TenderJobContext } | { ok: false; error: string }> {
  const run = await db.agentRun.findFirst({
    where: { id: ctx.runId, orgId: ctx.orgId },
    select: { id: true, metadata: true },
  });
  if (!run) {
    return { ok: false, error: "INPUT_MISSING: 找不到当前任务所属的 Job" };
  }
  const meta = (run.metadata ?? {}) as Record<string, unknown>;
  if (meta.workDomain !== "tender") {
    return {
      ok: false,
      error: "INPUT_MISSING: 投标分析工具仅限投标 AI 分析任务使用",
    };
  }
  const projectId =
    typeof meta.projectId === "string" ? meta.projectId.trim() : "";
  if (!projectId) {
    return {
      ok: false,
      error: "INPUT_MISSING: Job 未绑定项目，无法执行投标分析",
    };
  }
  return { ok: true, job: { jobId: run.id, projectId } };
}

/* ══════════ 声明证据的语义形状识别（#89：不读 stepKey 字面量） ══════════ */

function evidenceValues(prior: Record<string, unknown>): unknown[] {
  // 插入序 = dependsOn 声明序（executor scopedEvidenceByDependsOn 保证）
  return Object.values(prior ?? {});
}

export function findManifestEvidence(
  prior: Record<string, unknown>,
): TenderAnalysisInputManifest | null {
  for (const v of evidenceValues(prior)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (
      typeof r.analysisRunId === "string" &&
      typeof r.projectId === "string" &&
      Array.isArray(r.documents)
    ) {
      return r as unknown as TenderAnalysisInputManifest;
    }
  }
  return null;
}

/**
 * Segment 3 §9/§10 —— canonical V2 模式识别。
 *
 * 语义模式**只能**由本 run 上游任务的真实执行证据决定：
 * tender_analyze_package_v2 成功时在 tool result 里打 server 生成的 marker，
 * 下游投影工具在**声明依赖**的 durable evidence 里找它。
 *
 * 刻意不用的三种做法：
 *   - 嗅探 summaryJson 形状猜模式（旧 run 也可能有 V2 字段，猜就是猜）
 *   - 全库搜索找痕迹（越过 dependsOn 声明边界，破坏证据纪律）
 *   - 用环境 flag 决定单个工具语义（flag 只选编排路径，不选工具语义）
 */
export const TENDER_CANONICAL_V2_MARKER = "tenderCanonicalV2" as const;
export const TENDER_SEMANTIC_ENGINE_V2 = "tender-understanding-v2" as const;

export type CanonicalV2Evidence = {
  analysisRunId: string;
  semanticEngine: string;
  canonicalPersisted: boolean;
};

export function findCanonicalV2Evidence(
  prior: Record<string, unknown>,
): CanonicalV2Evidence | null {
  for (const v of evidenceValues(prior)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (
      r[TENDER_CANONICAL_V2_MARKER] === true &&
      r.semanticEngine === TENDER_SEMANTIC_ENGINE_V2 &&
      r.canonicalPersisted === true &&
      typeof r.analysisRunId === "string"
    ) {
      return {
        analysisRunId: r.analysisRunId,
        semanticEngine: r.semanticEngine as string,
        canonicalPersisted: true,
      };
    }
  }
  return null;
}

function findSynthesisEvidence(
  prior: Record<string, unknown>,
): { summary: string; conclusions: string[]; recommendations?: string[]; risks?: string[]; synthesisInputTruncated?: string[] } | null {
  for (const v of evidenceValues(prior)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (
      typeof r.summary === "string" &&
      Array.isArray(r.conclusions) &&
      Array.isArray(r.synthesisOf)
    ) {
      return r as unknown as {
        summary: string;
        conclusions: string[];
        recommendations?: string[];
        risks?: string[];
        synthesisInputTruncated?: string[];
      };
    }
  }
  return null;
}

/**
 * Manifest 回声（§16）：每个 tender handler 的输出都携带分析清单，
 * 使 manifest 沿 handoff 链传播——下游只要声明了任一 tender 上游即可
 * 取得清单（模型规划的 dependsOn 组合具有方差，不能假设人人直依 s1；
 * 证据仍严格限定声明上游，#89 语义不变、零未声明泄漏）。
 */
function manifestEcho(
  manifest: TenderAnalysisInputManifest,
): Record<string, unknown> {
  return {
    analysisRunId: manifest.analysisRunId,
    projectId: manifest.projectId,
    fingerprint: manifest.fingerprint,
    mode: manifest.mode,
    documents: manifest.documents,
    addendumCount: manifest.addendumCount,
  };
}

async function requireManifestFromEvidence(
  ctx: AdapterContext,
  job: TenderJobContext,
): Promise<
  | { ok: true; manifest: TenderAnalysisInputManifest }
  | { ok: false; error: string }
> {
  const manifest = findManifestEvidence(ctx.priorEvidence);
  if (!manifest) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 未在声明依赖中找到分析清单（该任务必须依赖 tender_validate_input）",
    };
  }
  if (manifest.projectId !== job.projectId) {
    return {
      ok: false,
      error: "INPUT_MISSING: 分析清单与当前项目不一致（拒绝跨项目输入）",
    };
  }
  const owned = await requireWorkforceTenderRun({
    orgId: ctx.orgId,
    projectId: job.projectId,
    analysisRunId: manifest.analysisRunId,
  });
  if (!owned.ok) return { ok: false, error: `INPUT_MISSING: ${owned.error}` };
  return { ok: true, manifest };
}

/* ══════════════════ 合规聚合（工具 4 与 finalize 共用） ══════════════════ */

async function computeComplianceAggregate(analysisRunId: string): Promise<{
  total: number;
  mandatory: number;
  evidenceRequired: number;
  sourceLinked: number;
  mandatoryWithoutSource: string[];
  complianceStatusCounts: Record<string, number>;
  factCount: number;
  sourceRefCount: number;
}> {
  const [requirements, factCount, sourceRefCount, reqRefs] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId },
      select: {
        id: true,
        requirementCode: true,
        originalRequirement: true,
        mandatory: true,
        evidenceRequired: true,
        complianceStatus: true,
      },
    }),
    db.tenderAnalysisFact.count({ where: { runId: analysisRunId } }),
    db.tenderAnalysisSourceRef.count({ where: { runId: analysisRunId } }),
    db.tenderAnalysisSourceRef.findMany({
      where: { runId: analysisRunId, requirementId: { not: null } },
      select: { requirementId: true },
    }),
  ]);
  const linked = new Set(reqRefs.map((r) => r.requirementId));
  const complianceStatusCounts: Record<string, number> = {};
  for (const r of requirements) {
    const key = r.complianceStatus ?? "UNKNOWN";
    complianceStatusCounts[key] = (complianceStatusCounts[key] ?? 0) + 1;
  }
  const mandatoryWithoutSource = requirements
    .filter((r) => r.mandatory && !linked.has(r.id))
    .slice(0, 10)
    .map((r) =>
      `${r.requirementCode}: ${r.originalRequirement}`.slice(0, 200),
    );
  return {
    total: requirements.length,
    mandatory: requirements.filter((r) => r.mandatory).length,
    evidenceRequired: requirements.filter((r) => r.evidenceRequired).length,
    sourceLinked: requirements.filter((r) => linked.has(r.id)).length,
    mandatoryWithoutSource,
    complianceStatusCounts,
    factCount,
    sourceRefCount,
  };
}

/* ══════════════════ 风险分析模型接缝（测试可注入；生产恒真模型） ══════════════════ */

type RiskModelInvoke = (input: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

/**
 * 测试接缝存放在 globalThis（Symbol key）：tsx 下测试文件的动态 import
 * 与执行链的静态 import 可能得到两个模块实例（repo 既知现象，
 * "跨模块实例 getAiStats 读不到"同源），module-level 变量会互不可见。
 * 进程级 globalThis 对加载器二象性免疫；仅 NODE_ENV=test 时读取。
 */
const RISK_STUB_KEY = Symbol.for("qingyan.tenderWorkforce.riskModelStub");

function riskModelOverrideForTests(): RiskModelInvoke | null {
  if (process.env.NODE_ENV !== "test") return null;
  const fn = (globalThis as Record<symbol, unknown>)[RISK_STUB_KEY];
  return typeof fn === "function" ? (fn as RiskModelInvoke) : null;
}

export function setTenderRiskModelForTests(fn: RiskModelInvoke | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setTenderRiskModelForTests 仅允许在 NODE_ENV=test 下调用");
  }
  (globalThis as Record<symbol, unknown>)[RISK_STUB_KEY] = fn ?? undefined;
}

const RiskModelOutputSchema = z
  .object({
    risks: z.array(TenderRiskItemSchema).max(24),
    summary: z.string().min(1).max(1200),
  })
  .strip();

/* ══════════════════ Handlers ══════════════════ */

async function handleValidateInput(ctx: AdapterContext): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const created = await createOrReuseWorkforceTenderAnalysisRun({
    orgId: ctx.orgId,
    projectId: jobCtx.job.projectId,
    jobId: jobCtx.job.jobId,
    userId: ctx.userId,
  });
  if (!created.ok) {
    return { ok: false, error: `${created.code}: ${created.error}` };
  }
  const m = created.manifest;
  return {
    ok: true,
    data: {
      ...m,
      summary: `已建立投标分析清单：${m.documents.length} 份文件（含 ${m.addendumCount} 份补遗），指纹 ${m.fingerprint.slice(0, 12)}…`,
    },
  };
}

async function handleParseDocuments(ctx: AdapterContext): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };

  const parsed: Array<{ documentId: string; pageCount: number | null; status: string }> = [];
  const unparsed: string[] = [];
  for (const doc of mf.manifest.documents) {
    // §35 双保险：文档必须真实属于当前项目
    const row = await db.projectDocument.findFirst({
      where: { id: doc.documentId, projectId: jobCtx.job.projectId },
      select: { id: true, parseStatus: true, pageCount: true },
    });
    if (!row) {
      return {
        ok: false,
        error: `INPUT_MISSING: 清单中的文档不属于当前项目（${doc.documentId}）`,
      };
    }
    // 幂等判定按真实 page 行（不是 parseStatus）：旧解析路径存在
    // parseStatus=done 但零 ProjectDocumentPage 的历史数据（真实生产形态），
    // 只看状态会静默跳过 → 下游零页面 fail-closed
    const existingPages = await db.projectDocumentPage.count({
      where: { documentId: doc.documentId },
    });
    if (row.parseStatus === "done" && existingPages > 0) {
      parsed.push({
        documentId: doc.documentId,
        pageCount: row.pageCount ?? existingPages,
        status: "already_parsed",
      });
      continue;
    }
    const result = await parseDocumentPagesAndStore(doc.documentId);
    if (result.ok) {
      parsed.push({
        documentId: doc.documentId,
        pageCount: result.pageCount,
        status: result.parseStatus,
      });
    } else {
      unparsed.push(`${doc.filename}: ${result.error}`.slice(0, 200));
    }
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: `DOCUMENT_PARSE_FAILED: 所有投标文件解析失败（${unparsed.join("；").slice(0, 400)}）`,
    };
  }
  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderParse: true,
      parsedDocuments: parsed,
      unparsedDocuments: unparsed,
      summary: `已解析 ${parsed.length}/${mf.manifest.documents.length} 份投标文件${unparsed.length > 0 ? `（${unparsed.length} 份无法解析，已记录为限制）` : ""}`,
    },
  };
}

async function handleExtractRequirements(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  const pages = await db.projectDocumentPage.count({
    where: { documentId: { in: mf.manifest.documents.map((d) => d.documentId) } },
  });
  if (pages === 0) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 投标文件尚未解析出任何页面文本（需先完成文档解析）",
    };
  }

  // 共享 service（legacy 与 workforce 同源）：facts + requirements + 章节
  const extracted = await extractFromPages({ runId });
  const requirements = await extractRequirements({ runId });
  const sections = await generateReportSections({ runId });
  const aggregate = await computeComplianceAggregate(runId);

  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderExtract: true,
      factCount: extracted.factCount,
      requirementCount: requirements.requirementCount,
      mandatoryCount: aggregate.mandatory,
      sectionCount: sections.sectionCount,
      sourceRefCount: aggregate.sourceRefCount,
      summary: `已提取 ${requirements.requirementCount} 条投标要求（其中强制 ${aggregate.mandatory} 条）、${extracted.factCount} 条事实与 ${aggregate.sourceRefCount} 条来源引用，并生成 ${sections.sectionCount} 个报告章节`,
    },
  };
}

async function handleEvidenceCompliance(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };

  const aggregate = await computeComplianceAggregate(mf.manifest.analysisRunId);
  if (aggregate.total === 0) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 尚无已提取的投标要求可分析（需先完成要求提取）",
    };
  }
  // §11：本工具**本来就是**只读聚合（computeComplianceAggregate 只做 DB 统计，
  // 零 LLM、零写）。V2 下无需改变语义，只把模式标进输出便于审计与下游识别。
  const canonicalV2 = findCanonicalV2Evidence(ctx.priorEvidence);
  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderCompliance: true,
      ...(canonicalV2
        ? {
            canonicalProjection: true,
            semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
          }
        : {}),
      requirementsSummary: {
        total: aggregate.total,
        mandatory: aggregate.mandatory,
        evidenceRequired: aggregate.evidenceRequired,
        sourceLinked: aggregate.sourceLinked,
      },
      complianceStatusCounts: aggregate.complianceStatusCounts,
      mandatoryWithoutSource: aggregate.mandatoryWithoutSource,
      summary: `证据覆盖：${aggregate.total} 条要求中 ${aggregate.sourceLinked} 条已挂来源；强制要求 ${aggregate.mandatory} 条，其中 ${aggregate.mandatoryWithoutSource.length} 条缺少来源支撑`,
    },
  };
}

/**
 * canonical V2 风险的**唯一存放位置**（本轮审计确认，非推测）：
 * v2-map.ts 把 `{ risks: RiskV2[], conflicts: ConflictV2[] }` 写进
 * TenderAnalysisSection(sectionKey="RISKS").structuredJson，由
 * persistV2CanonicalTx 落库。RiskV2 用 `description`；
 * legacy workforce 风险工具写的是 `{version:"tender-workforce-risks/v1", risks:[{statement}]}`。
 * 形状本身即可区分两者——读到后者说明模式串了，fail-closed。
 */
type CanonicalV2Risk = {
  id?: string;
  severity: string;
  riskType?: string;
  description: string;
  reasonCode?: string;
};

function readCanonicalV2Risks(structuredJson: unknown):
  | { ok: true; risks: CanonicalV2Risk[]; conflicts: unknown[] }
  | { ok: false; error: string } {
  if (!structuredJson || typeof structuredJson !== "object") {
    return { ok: false, error: "canonical RISKS 章节缺少结构化结果" };
  }
  const sj = structuredJson as Record<string, unknown>;
  if (!Array.isArray(sj.risks)) {
    return { ok: false, error: "canonical RISKS 章节的 risks 不是数组" };
  }
  if (typeof sj.version === "string") {
    return {
      ok: false,
      error: `RISKS 章节是 ${sj.version} 形状（Workforce 二次生成结果），不是 canonical V2 输出`,
    };
  }
  const risks: CanonicalV2Risk[] = [];
  for (const [i, raw] of (sj.risks as unknown[]).entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (typeof r.severity !== "string" || typeof r.description !== "string") {
      return {
        ok: false,
        error: `canonical 风险第 ${i + 1} 条缺少 severity/description`,
      };
    }
    risks.push({
      id: typeof r.id === "string" ? r.id : undefined,
      severity: r.severity,
      riskType: typeof r.riskType === "string" ? r.riskType : undefined,
      description: r.description,
      reasonCode: typeof r.reasonCode === "string" ? r.reasonCode : undefined,
    });
  }
  return {
    ok: true,
    risks,
    conflicts: Array.isArray(sj.conflicts) ? (sj.conflicts as unknown[]) : [],
  };
}

async function handleRiskAnalysis(ctx: AdapterContext): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  // ── canonical V2 模式：只读投影，零模型调用、零 canonical 写 ──
  const canonicalV2 = findCanonicalV2Evidence(ctx.priorEvidence);
  if (canonicalV2) {
    if (canonicalV2.analysisRunId !== runId) {
      return {
        ok: false,
        error: "INPUT_MISSING: canonical V2 证据与本次分析记录不一致",
      };
    }
    const section = await db.tenderAnalysisSection.findFirst({
      where: { runId, sectionKey: "RISKS" },
      select: { structuredJson: true },
    });
    if (!section) {
      return {
        ok: false,
        error: "CANONICAL_MISSING: canonical V2 已声明落库，但 RISKS 章节不存在",
      };
    }
    const parsed = readCanonicalV2Risks(section.structuredJson);
    if (!parsed.ok) {
      return { ok: false, error: `CANONICAL_INVALID: ${parsed.error}` };
    }
    const bySeverity = (sev: string) =>
      parsed.risks.filter((r) => r.severity.toUpperCase() === sev).length;
    return {
      ok: true,
      data: {
        ...manifestEcho(mf.manifest),
        tenderRisks: true,
        canonicalProjection: true,
        semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
        risks: parsed.risks.slice(0, 20).map((r) => ({
          severity: r.severity,
          riskType: r.riskType,
          description: r.description.slice(0, 400),
        })),
        conflictCount: parsed.conflicts.length,
        counts: {
          critical: bySeverity("CRITICAL"),
          high: bySeverity("HIGH"),
          medium: bySeverity("MEDIUM"),
          informational: bySeverity("INFORMATIONAL"),
        },
        summary: `canonical 风险投影：${parsed.risks.length} 条（CRITICAL ${bySeverity("CRITICAL")} / HIGH ${bySeverity("HIGH")}），冲突 ${parsed.conflicts.length} 项。仅投影，不重新生成风险`,
      },
    };
  }

  const [requirements, facts] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: runId },
      orderBy: { requirementCode: "asc" },
      take: 60,
      select: {
        requirementCode: true,
        category: true,
        originalRequirement: true,
        mandatory: true,
        evidenceRequired: true,
        complianceStatus: true,
      },
    }),
    db.tenderAnalysisFact.findMany({
      where: { runId },
      take: 60,
      select: {
        statementKind: true,
        contentZh: true,
        sourceRefs: {
          take: 1,
          select: { pageNumber: true, documentId: true },
        },
      },
    }),
  ]);
  if (requirements.length === 0) {
    return {
      ok: false,
      error: "INPUT_MISSING: 尚无已提取的投标要求，无法进行风险分析",
    };
  }
  const aggregate = await computeComplianceAggregate(runId);

  const systemPrompt = `你是青砚投标风险分析执行器。基于且仅基于给定的投标要求、事实与证据覆盖统计做风险分析。
规则：
- 不得编造输入中不存在的要求、日期、数字或文档
- 每条风险给出 severity（CRITICAL/HIGH/MEDIUM/INFORMATIONAL）与 kind（MANDATORY_REQUIREMENT_MISSING/CONTRADICTION/AMBIGUOUS_SPECIFICATION/ADDENDUM_CONFLICT/MISSING_DOCUMENT/SUBMISSION_RISK/TECHNICAL_INCOMPATIBILITY/COMMERCIAL_UNKNOWN/OTHER）
- statement 用中文陈述具体风险；source 引用支撑该判断的要求编号或文档（可追溯）
- 不要把普通要求当风险；只报告真实缺口、矛盾、歧义与不确定性
- 只输出 JSON：{"risks":[{"severity":"...","kind":"...","statement":"...","source":"..."}],"summary":"..."}`;

  const userPrompt = JSON.stringify({
    project: { addendumCount: mf.manifest.addendumCount },
    documents: mf.manifest.documents.map((d) => ({
      filename: d.filename,
      role: d.role,
      pageCount: d.pageCount,
    })),
    requirements,
    facts: facts.map((f) => ({
      kind: f.statementKind,
      content: f.contentZh,
      source: f.sourceRefs[0]
        ? `doc:${f.sourceRefs[0].documentId} p${f.sourceRefs[0].pageNumber ?? "?"}`
        : undefined,
    })),
    evidenceCoverage: {
      total: aggregate.total,
      mandatory: aggregate.mandatory,
      sourceLinked: aggregate.sourceLinked,
      mandatoryWithoutSource: aggregate.mandatoryWithoutSource,
    },
  });

  let raw: string;
  try {
    const stub = riskModelOverrideForTests();
    if (stub) {
      raw = await stub({ systemPrompt, userPrompt });
    } else {
      raw = await createCompletion({
        systemPrompt,
        userPrompt,
        temperature: 0,
        maxTokens: 4000,
        orgId: ctx.orgId,
        userId: ctx.userId,
      });
    }
  } catch (err) {
    return {
      ok: false,
      error: `MODEL_FAILED: 风险分析模型调用失败（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: "MODEL_FAILED: 风险分析模型未返回结构化结果" };
  }
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: "MODEL_FAILED: 风险分析结果 JSON 无法解析" };
  }
  const parsed = RiskModelOutputSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `MODEL_FAILED: 风险分析结果不符合契约（${parsed.error.message.slice(0, 200)}）`,
    };
  }

  const risks = parsed.data.risks;
  const contentZh = [
    parsed.data.summary,
    "",
    ...risks.map(
      (r) =>
        `【${r.severity}】${r.statement}${r.source ? `（来源：${r.source}）` : ""}`,
    ),
  ].join("\n");
  const persisted = await upsertWorkforceRiskSection({
    orgId: ctx.orgId,
    projectId: jobCtx.job.projectId,
    analysisRunId: runId,
    contentZh: contentZh.slice(0, 8000),
    structuredJson: { version: "tender-workforce-risks/v1", risks },
  });
  if (!persisted.ok) {
    return { ok: false, error: `TOOL_FAILED: ${persisted.error}` };
  }

  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderRisks: true,
      risks,
      riskSummary: parsed.data.summary,
      counts: {
        critical: risks.filter((r) => r.severity === "CRITICAL").length,
        high: risks.filter((r) => r.severity === "HIGH").length,
        medium: risks.filter((r) => r.severity === "MEDIUM").length,
        informational: risks.filter((r) => r.severity === "INFORMATIONAL")
          .length,
      },
      summary: `风险分析：${risks.length} 条（CRITICAL ${risks.filter((r) => r.severity === "CRITICAL").length} / HIGH ${risks.filter((r) => r.severity === "HIGH").length}）。${parsed.data.summary}`.slice(
        0,
        480,
      ),
    },
  };
}

async function handleClarificationDraft(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  // ── canonical V2 模式：澄清已由 V2 引擎生成并落库，只做投影 ──
  const canonicalV2 = findCanonicalV2Evidence(ctx.priorEvidence);
  if (canonicalV2) {
    if (canonicalV2.analysisRunId !== runId) {
      return {
        ok: false,
        error: "INPUT_MISSING: canonical V2 证据与本次分析记录不一致",
      };
    }
    const rows = await db.tenderClarificationQuestion.findMany({
      where: { analysisRunId: runId },
      orderBy: { createdAt: "asc" },
      select: { question: true, reason: true, priority: true, status: true },
    });
    return {
      ok: true,
      data: {
        ...manifestEcho(mf.manifest),
        tenderClarifications: true,
        canonicalProjection: true,
        semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
        clarificationCount: rows.length,
        drafts: rows.slice(0, 12).map((q) => ({
          question: q.question.slice(0, 400),
          reason: (q.reason ?? "").slice(0, 300),
          priority: q.priority,
        })),
        draftOnly: true,
        summary: `canonical 澄清投影：${rows.length} 条（仅草稿，须人工决定是否发出）。不二次生成问题`,
      },
    };
  }

  const built = await buildClarifications({ runId });
  const questions = await db.tenderClarificationQuestion.findMany({
    where: { analysisRunId: runId },
    take: 12,
    select: { question: true, reason: true, priority: true },
  });
  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderClarifications: true,
      clarificationCount: built.clarificationCount,
      drafts: questions.map((q) => ({
        question: q.question.slice(0, 400),
        reason: (q.reason ?? "").slice(0, 300),
        priority: q.priority,
      })),
      draftOnly: true,
      summary: `已起草 ${built.clarificationCount} 条澄清问题（仅草稿，须人工决定是否发出）`,
    },
  };
}

async function handleBuildDeliverables(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  // 唯一领域实现：与 legacy 同一 service 文件（零业务逻辑复制）
  const built = await buildGroundedDeliverables({ runId });
  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderDeliverables: true,
      deliverableCount: built.deliverableCount,
      checklistCount: built.checklistCount,
      deliverables: built.deliverables.slice(0, 20).map((d) => ({
        key: d.deliverableKey,
        title: d.title.slice(0, 200),
        mandatory: d.mandatory,
        requirementCode: d.requirementCode,
        sourcePage: d.sourcePage,
      })),
      summary:
        built.deliverableCount > 0
          ? `已按 canonical 提交清单投影 ${built.deliverableCount} 项交付物（1:1，可追溯到要求编号与来源页）`
          : `canonical 提交清单为空（本标书无提交类强制要求），未产出交付物——不套固定模板`,
    },
  };
}

async function handleFinalizeAnalysis(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  const synthesis = findSynthesisEvidence(ctx.priorEvidence);
  if (!synthesis) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 未在声明依赖中找到综合汇总结果（该任务必须依赖 synthesis 任务）",
    };
  }

  // ── canonical V2 模式：只做状态终态化，绝不覆盖 canonical 语义 ──
  // 模式由**声明依赖里的 canonical V2 执行证据**决定（§18），
  // 不靠"summaryJson 里有没有 submissionChecklist"猜。
  const canonicalV2 = findCanonicalV2Evidence(ctx.priorEvidence);
  if (canonicalV2) {
    if (canonicalV2.analysisRunId !== runId) {
      return {
        ok: false,
        error: "INPUT_MISSING: canonical V2 证据与本次分析记录不一致",
      };
    }
    const finalizedV2 = await finalizeWorkforceTenderCanonicalV2Run({
      orgId: ctx.orgId,
      projectId: jobCtx.job.projectId,
      analysisRunId: runId,
    });
    if (!finalizedV2.ok) {
      return { ok: false, error: `TOOL_FAILED: ${finalizedV2.error}` };
    }
    const aggregateV2 = await computeComplianceAggregate(runId);
    return {
      ok: true,
      data: {
        tenderFinalized: true,
        canonicalProjection: true,
        semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
        analysisRunId: runId,
        requirementCount: aggregateV2.total,
        // §19：Job 级综合结论可以随 tool result 返回（供 Job Center 展示），
        // 但**绝不**写回 Tender canonical 记录——canonical 语义只有一个来源。
        jobSummary: synthesis.summary.slice(0, 480),
        summary: `canonical V2 分析已终态化（${aggregateV2.total} 条要求），进入待人工审核；V2 结果与摘要原样保留`,
      },
    };
  }

  const aggregate = await computeComplianceAggregate(runId);
  const [riskSection, clarifications, docs] = await Promise.all([
    db.tenderAnalysisSection.findFirst({
      where: { runId, sectionKey: "RISKS" },
      select: { structuredJson: true },
    }),
    db.tenderClarificationQuestion.findMany({
      where: { analysisRunId: runId },
      take: 12,
      select: { question: true, reason: true, priority: true },
    }),
    db.projectDocument.findMany({
      where: {
        id: { in: mf.manifest.documents.map((d) => d.documentId) },
        projectId: jobCtx.job.projectId,
      },
      select: { id: true, title: true, parseStatus: true, pageCount: true },
    }),
  ]);

  const structuredRisks: TenderRiskItem[] = (() => {
    const sj = riskSection?.structuredJson as
      | { risks?: unknown }
      | null
      | undefined;
    if (!sj || !Array.isArray(sj.risks)) return [];
    return sj.risks
      .map((r) => TenderRiskItemSchema.safeParse(r))
      .filter((p): p is { success: true; data: TenderRiskItem } => p.success)
      .map((p) => p.data);
  })();

  const critical = structuredRisks.filter((r) => r.severity === "CRITICAL");
  const important = structuredRisks.filter((r) => r.severity === "HIGH");
  const submission = structuredRisks.filter(
    (r) => r.kind === "SUBMISSION_RISK",
  );

  const parsedPageCount = docs.reduce((n, d) => n + (d.pageCount ?? 0), 0);
  const limitations: string[] = [];
  for (const d of docs) {
    if (d.parseStatus !== "done") {
      limitations.push(
        `文件「${d.title}」未能完整解析（${d.parseStatus}），其内容未纳入分析`.slice(0, 300),
      );
    }
  }
  if (synthesis.synthesisInputTruncated?.length) {
    limitations.push("部分上游任务产出因体量限制被截断后综合");
  }
  if (limitations.length === 0) {
    limitations.push("分析范围以当前已上传的投标文件包为准");
  }

  const missingInformation = aggregate.mandatoryWithoutSource.map((m) =>
    `强制要求缺少来源支撑：${m}`.slice(0, 480),
  );

  const readiness: TenderAnalysisResultV1["readiness"] =
    critical.length > 0 || missingInformation.length > 0
      ? "GAPS_FOUND"
      : "READY_TO_REVIEW";

  const result: TenderAnalysisResultV1 = {
    contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
    projectSummary: synthesis.summary.slice(0, 2000),
    readiness,
    requirementsSummary: {
      total: aggregate.total,
      mandatory: aggregate.mandatory,
      evidenceRequired: aggregate.evidenceRequired,
      sourceLinked: aggregate.sourceLinked,
    },
    missingInformation: missingInformation.slice(0, 12),
    criticalRisks: critical.slice(0, 12),
    importantRisks: important.slice(0, 12),
    clarifications: clarifications.map((q) => ({
      question: q.question.slice(0, 500),
      reason: (q.reason ?? "分析过程中识别的不确定项").slice(0, 500) || "分析过程中识别的不确定项",
      priority: (["HIGH", "MEDIUM", "LOW"] as const).includes(
        q.priority as "HIGH" | "MEDIUM" | "LOW",
      )
        ? (q.priority as "HIGH" | "MEDIUM" | "LOW")
        : "MEDIUM",
      whyOwnerNeedsToAnswer: (q.reason ?? "该信息影响投标合规与报价判断").slice(0, 500) || "该信息影响投标合规与报价判断",
    })),
    submissionRisks: submission.map((r) => r.statement.slice(0, 500)).slice(0, 12),
    recommendedNextActions: [
      ...(synthesis.recommendations ?? []).map((r) => r.slice(0, 500)),
      "人工审阅本次 AI 分析结果并确认要求清单",
    ].slice(0, 12),
    sourceCoverage: {
      documentCount: mf.manifest.documents.length,
      parsedPageCount,
      factCount: aggregate.factCount,
      sourceRefCount: aggregate.sourceRefCount,
    },
    analysisLimitations: limitations.slice(0, 12),
  };

  const summaryText =
    `AI 投标分析：${aggregate.total} 条要求（强制 ${aggregate.mandatory}）｜关键风险 ${critical.length}｜澄清草稿 ${clarifications.length}｜${readiness === "GAPS_FOUND" ? "发现缺口，需人工确认" : "待人工审阅"}`.slice(
      0,
      500,
    );

  const finalized = await finalizeWorkforceTenderAnalysisRun({
    orgId: ctx.orgId,
    projectId: jobCtx.job.projectId,
    analysisRunId: runId,
    result,
    summaryText,
  });
  if (!finalized.ok) {
    return { ok: false, error: `TOOL_FAILED: ${finalized.error}` };
  }

  return {
    ok: true,
    data: {
      tenderFinalized: true,
      analysisRunId: runId,
      readiness,
      requirementCount: aggregate.total,
      criticalRiskCount: critical.length,
      clarificationCount: clarifications.length,
      summary: summaryText,
    },
  };
}

/* ══════════ canonical V2 分析（T5-P1 Segment 2；能力就绪、当前 DAG 不可达） ══════════ */

/**
 * 跑 canonical V2 grounded 引擎并以 **Workforce 执行权** 原子落库。
 *
 * 与 legacy 的边界（§13 明令）：调用的是 runV2Inference + Workforce 防栅栏
 * 持久化，**不碰** legacy enqueue / cron / worker.ts / analyzeAndPersistV2，
 * 不创建第二个 AgentRun 或第二个 Workforce Job。
 *
 * 本工具不改变 TenderAnalysisRun 状态：落库后仍是 AGENT_ANALYZING，
 * 终态化由 finalize 步骤单独负责（Segment 2 不接线，见 §17）。
 */
async function handleAnalyzePackageV2(
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const jobCtx = await requireTenderJobContext(ctx);
  if (!jobCtx.ok) return { ok: false, error: jobCtx.error };
  const mf = await requireManifestFromEvidence(ctx, jobCtx.job);
  if (!mf.ok) return { ok: false, error: mf.error };
  const runId = mf.manifest.analysisRunId;

  // server-only 写防栅栏：没有执行权凭证就绝不进入 canonical 写路径
  const runFence = ctx.runFence;
  if (!runFence) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 缺少运行时写防栅栏（canonical V2 落库必须在 Workforce 执行权保护下进行）",
    };
  }

  const pages = await db.projectDocumentPage.count({
    where: { documentId: { in: mf.manifest.documents.map((d) => d.documentId) } },
  });
  if (pages === 0) {
    return {
      ok: false,
      error:
        "INPUT_MISSING: 投标文件尚未解析出任何页面文本（需先完成文档解析）",
    };
  }

  const { mapped, model, llmCalls, llmFailures } = await runV2Inference({
    runId,
  });

  // §14：复用**同一个** empty-analysis 判定（不发明第二套），
  // 且在落库之前判定——空壳分析不该留下 canonical 痕迹。
  if (
    isEmptyAnalysisOutcome({
      llmCalls,
      llmFailures,
      factCount: mapped.facts.length,
      requirementCount: mapped.requirements.length,
    })
  ) {
    return {
      ok: false,
      error: `ANALYSIS_EMPTY: 本次分析零成功模型调用且零抽取产出（${llmFailures}/${llmCalls} 次调用失败），拒绝写入空结果`,
    };
  }

  const persisted = await persistV2ForWorkforce({
    orgId: ctx.orgId,
    projectId: jobCtx.job.projectId,
    analysisRunId: runId,
    jobId: jobCtx.job.jobId,
    mapped,
    model,
    runFence,
  });

  return {
    ok: true,
    data: {
      ...manifestEcho(mf.manifest),
      tenderAnalyzePackageV2: true,
      // §9：canonical 模式 marker——server 生成、只来自本工具的真实成功执行。
      // 客户端 / task input / goal / metadata 都无法伪造进 tool result。
      [TENDER_CANONICAL_V2_MARKER]: true,
      semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
      canonicalPersisted: true,
      engine: "v2",
      factCount: persisted.factCount,
      requirementCount: persisted.requirementCount,
      clarificationCount: persisted.clarificationCount,
      changeCount: persisted.changeCount,
      sectionCount: persisted.sectionCount,
      llmCalls,
      llmFailures,
      model,
      summary: `canonical V2 分析已落库：${persisted.requirementCount} 条要求、${persisted.factCount} 条事实、${persisted.clarificationCount} 条澄清、${persisted.sectionCount} 个章节`,
    },
  };
}

/* ══════════════════ Handler 注册表（并入 authoritative handler map） ══════════════════ */

export const TENDER_WORKFORCE_TOOL_HANDLERS: Record<
  TenderWorkforceToolName,
  TenderToolHandler
> = {
  tender_validate_input: handleValidateInput,
  tender_parse_documents: handleParseDocuments,
  tender_extract_requirements: handleExtractRequirements,
  tender_evidence_compliance: handleEvidenceCompliance,
  tender_risk_analysis: handleRiskAnalysis,
  tender_clarification_draft: handleClarificationDraft,
  tender_build_deliverables: handleBuildDeliverables,
  tender_finalize_analysis: handleFinalizeAnalysis,
  tender_analyze_package_v2: handleAnalyzePackageV2,
};

/** Job 失败/取消时的域侧兜底（trigger 层调用；工具层不管 Run 级状态） */
export { failWorkforceTenderAnalysisRun };
