/**
 * Phase E — V2 结果 → 现有持久化实体（生产侧映射，纯函数）
 *
 * 约束：本文件属生产模块，绝不 import tender-eval（golden 是考卷不是训练数据）。
 * 映射不发明信息：V2 未给出的字段一律标"（待核）/（暂无）"，不套 RCMP 模板。
 * 语言：V2 输出为源语言（英文标书 → 英文陈述）。UI 中文章节承载英文原文，
 * 翻译作为已知 limitation（见报告），此处 contentZh 落英文陈述而非编造中文。
 */

import type {
  AnalysisResultV2,
  CriticalFactType,
  DocumentFactV2,
  TenderRequirementV2,
} from "@/lib/tender-understanding/contract";
import type {
  ConfidenceLevel,
  SectionKey,
  StatementKind,
} from "./constants";

/** V2 置信度 → 存储置信度 */
export const V2_CONFIDENCE_MAP: Record<
  DocumentFactV2["confidence"],
  ConfidenceLevel
> = {
  HIGH: "CONFIRMED",
  MEDIUM: "HIGH_CONFIDENCE",
  LOW: "INFERRED",
};

/** RunDocument.role（String）→ V2 DocumentSourceRole */
export function mapRunRoleToV2Role(
  role: string | null | undefined,
): AnalysisResultV2["manifest"]["documents"][number]["sourceRole"] {
  switch ((role ?? "").toUpperCase()) {
    case "PRIMARY":
      return "BASE_TENDER";
    case "ADDENDUM":
      return "ADDENDUM";
    case "DRAWING":
      return "DRAWING";
    case "PRICING":
      return "PRICING_FORM";
    case "FORM":
      return "SUBMISSION_FORM";
    case "SUPPLEMENT":
      return "SPECIFICATION";
    default:
      return "OTHER";
  }
}

export type V2SourceRefInput = {
  documentId: string;
  pageNumber: number | null;
  originalTextSnippet: string;
  sectionLabel: string | null;
  extractionMethod: string;
  confidence: ConfidenceLevel;
};

export type V2FactInput = {
  statementKind: StatementKind;
  contentZh: string;
  contentOriginal: string;
  confidence: ConfidenceLevel;
  sourceRefs: V2SourceRefInput[];
};

export type V2RequirementInput = {
  requirementCode: string;
  category: string;
  originalRequirement: string;
  chineseTranslation: string;
  mandatory: boolean;
  evidenceRequired: boolean;
  complianceStatus: "NOT_ASSESSED" | "NEEDS_CLARIFICATION";
  sourcePage: number | null;
  sourceRefs: V2SourceRefInput[];
};

export type V2ClarificationInput = {
  question: string;
  reason: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";
  enquiryDeadline: Date | null;
  sourceRefs: V2SourceRefInput[];
};

export type V2ChangeInput = {
  changeType:
    | "ADDED"
    | "REMOVED"
    | "MODIFIED"
    | "DATE_CHANGED"
    | "QUANTITY_CHANGED"
    | "PRICING_CHANGED";
  entityType: string;
  entityKey: string | null;
  summaryZh: string;
};

export type V2SectionInput = {
  sectionKey: SectionKey;
  contentZh: string;
  structuredJson: unknown;
  confidence: ConfidenceLevel;
};

export type V2MappedResult = {
  facts: V2FactInput[];
  requirements: V2RequirementInput[];
  clarifications: V2ClarificationInput[];
  changeCandidates: V2ChangeInput[];
  sections: V2SectionInput[];
  summaryText: string;
  summaryJson: Record<string, unknown>;
};

const NA = "（待核）";

function refsOf(
  evidence: DocumentFactV2["evidence"],
  method: string,
  confidence: ConfidenceLevel,
): V2SourceRefInput[] {
  return evidence.map((e) => ({
    documentId: e.documentId,
    pageNumber: e.pageNumber ?? null,
    originalTextSnippet: (e.snippet ?? "").slice(0, 400),
    sectionLabel: null,
    extractionMethod: method,
    confidence,
  }));
}

function mapChangeType(action: string): V2ChangeInput["changeType"] {
  switch (action.toUpperCase()) {
    case "DELETES":
    case "DELETE":
      return "REMOVED";
    case "ADDS":
    case "ADD":
      return "ADDED";
    case "EXTENDS":
      return "DATE_CHANGED";
    default:
      return "MODIFIED";
  }
}

/** 由 criticalFacts 槽位取事实 claim（KNOWN → claim；UNKNOWN → 待核）。 */
function criticalClaim(
  result: AnalysisResultV2,
  field: CriticalFactType,
  factById: Map<string, DocumentFactV2>,
): string {
  const slot = result.criticalFacts[field];
  if (slot && slot.status === "KNOWN") {
    return factById.get(slot.factId)?.claim ?? NA;
  }
  return NA;
}

function reqLines(reqs: TenderRequirementV2[]): string {
  if (reqs.length === 0) return "（暂无）";
  return reqs
    .map(
      (r) =>
        `• ${r.statement}${r.mandatory === true ? "（强制）" : ""}${
          r.status === "NEEDS_REVIEW" ? "（需复核）" : ""
        }`,
    )
    .join("\n");
}

/** 纯映射：AnalysisResultV2 → 现有实体输入 + 16 章节 + 摘要。 */
export function mapV2Result(result: AnalysisResultV2): V2MappedResult {
  const factById = new Map(result.facts.map((f) => [f.id, f]));

  // —— facts（仅 ACTIVE 入库；SUPERSEDED/CONFLICT 由 requirements/conflicts 表达） ——
  const facts: V2FactInput[] = result.facts
    .filter((f) => f.status === "ACTIVE")
    .map((f) => ({
      statementKind: "CONFIRMED_FACT" as StatementKind,
      contentZh: f.claim,
      contentOriginal: f.rawValue ?? f.claim,
      confidence: V2_CONFIDENCE_MAP[f.confidence],
      sourceRefs: refsOf(f.evidence, "v2-llm-extract", V2_CONFIDENCE_MAP[f.confidence]),
    }));

  // —— requirements（ACTIVE + NEEDS_REVIEW；绝不自动 COMPLIANT） ——
  const activeReqs = result.requirements.filter(
    (r) => r.status === "ACTIVE" || r.status === "NEEDS_REVIEW",
  );
  const requirements: V2RequirementInput[] = activeReqs.map((r) => ({
    requirementCode: r.id,
    category: r.category.toLowerCase(),
    originalRequirement: r.statement,
    chineseTranslation: r.statement,
    mandatory: r.mandatory === true,
    evidenceRequired: false,
    complianceStatus:
      r.status === "NEEDS_REVIEW" ? "NEEDS_CLARIFICATION" : "NOT_ASSESSED",
    sourcePage: r.evidence[0]?.pageNumber ?? null,
    sourceRefs: refsOf(r.evidence, "v2-llm-extract", V2_CONFIDENCE_MAP[r.confidence]),
  }));

  // —— clarifications ——
  const clarifications: V2ClarificationInput[] = result.clarifications.map((c) => ({
    question: c.question,
    reason: c.reason,
    priority: c.priority,
    enquiryDeadline: null,
    sourceRefs: refsOf(c.supportingEvidence, "v2-clarify", "HIGH_CONFIDENCE"),
  }));

  // —— addendum precedence → change candidates（含 FULL run 内部覆盖） ——
  const changeCandidates: V2ChangeInput[] = result.addendumChanges.map((a) => ({
    changeType: mapChangeType(a.action),
    entityType: "requirement",
    entityKey: a.activeRequirementId ?? a.supersededRequirementId ?? null,
    summaryZh: a.note,
  }));
  // 未被补遗解决的冲突亦作为变更候选暴露（需人工澄清，绝不自动择一）
  for (const cf of result.conflicts) {
    if (cf.resolution === "UNRESOLVED") {
      changeCandidates.push({
        changeType: "MODIFIED",
        entityType: "conflict",
        entityKey: cf.itemIds[0] ?? null,
        summaryZh: `冲突（未解决）：${cf.topic} — ${cf.values.join(" ↔ ")}。${cf.note}`,
      });
    }
  }

  // —— 章节（16 键全覆盖；grounded，缺失标 待核/暂无） ——
  // 章节 → V2 RequirementCategory 分组（大写枚举）。无匹配的章节给出中性指引，不编造。
  const byCats = (...cats: string[]) => {
    const set = new Set(cats.map((c) => c.toUpperCase()));
    return activeReqs.filter((r) => set.has(r.category.toUpperCase()));
  };
  const mandatoryReqs = activeReqs.filter((r) => r.mandatory === true);
  const riskLines =
    result.risks.length > 0
      ? result.risks
          .map((r) => `• [${r.severity}] ${r.description}`)
          .join("\n")
      : "（暂无已识别风险）";
  const conflictLines = result.conflicts
    .map(
      (c) =>
        `• ${c.topic}：${c.values.join(" ↔ ")}（${
          c.resolution === "RESOLVED_BY_ADDENDUM" ? "已由补遗解决" : "未解决，需澄清"
        }）`,
    )
    .join("\n");
  const clarLines =
    result.clarifications.length > 0
      ? result.clarifications
          .map((c) => `• [${c.priority}] ${c.question}（${c.reason}）`)
          .join("\n")
      : "（暂无）";
  const nextActionLines =
    result.nextActions.length > 0
      ? result.nextActions.map((a) => `• ${a}`).join("\n")
      : "（暂无）";

  const sec = (
    sectionKey: SectionKey,
    contentZh: string,
    structuredJson: unknown = null,
    confidence: ConfidenceLevel = "INFERRED",
  ): V2SectionInput => ({ sectionKey, contentZh, structuredJson, confidence });

  const sections: V2SectionInput[] = [
    sec("EXECUTIVE_SUMMARY", result.projectSummary || NA, { projectSummary: result.projectSummary }, "HIGH_CONFIDENCE"),
    sec(
      "PROJECT_INFORMATION",
      [
        `采购单位：${criticalClaim(result, "buyer" as CriticalFactType, factById)}`,
        `招标编号：${criticalClaim(result, "tender_number" as CriticalFactType, factById)}`,
        `截止时间：${criticalClaim(result, "closing_datetime" as CriticalFactType, factById)}`,
      ].join("\n"),
      { criticalFacts: result.criticalFacts },
      "HIGH_CONFIDENCE",
    ),
    sec("PROCUREMENT_STRUCTURE", reqLines(byCats("PRODUCT", "TECHNICAL", "PERFORMANCE")), null),
    sec("PRODUCT_SCOPE", reqLines(byCats("PRODUCT", "TECHNICAL", "WARRANTY")), null),
    sec("MANDATORY_REQUIREMENTS", reqLines(mandatoryReqs), { count: mandatoryReqs.length }, "HIGH_CONFIDENCE"),
    sec("SUBMISSION_REQUIREMENTS", reqLines(byCats("SUBMISSION", "SHOP_DRAWINGS", "SAMPLES", "REPORTING")), { checklist: result.submissionChecklist }),
    sec("PRICING_EVALUATION", reqLines(byCats("PRICING", "COMMERCIAL")), null),
    sec("DELIVERY_LOGISTICS", reqLines(byCats("DELIVERY", "INSTALLATION", "SCHEDULE")), null),
    sec("PAYMENT", reqLines(byCats("COMMERCIAL")), null),
    sec("CERTIFICATIONS", reqLines(byCats("SAFETY", "TRAINING")), null),
    sec("ELIGIBILITY", reqLines(byCats("ADMINISTRATIVE", "BONDING", "INSURANCE")), null),
    sec("RISKS", `${riskLines}\n${conflictLines ? `\n冲突：\n${conflictLines}` : ""}`, { risks: result.risks, conflicts: result.conflicts }, "INFERRED"),
    sec("COMMERCIAL_ANALYSIS", "（需人工结合企业能力评估）", null),
    sec("BID_STRATEGY", nextActionLines, { nextActions: result.nextActions }),
    sec("CLARIFICATION_QUESTIONS", clarLines, null, "HIGH_CONFIDENCE"),
    sec(
      "FINAL_RECOMMENDATION",
      `${result.projectSummary || NA}\n\nAI 建议（需人工确认）：请结合上方风险、缺失信息与澄清问题综合判断是否投标。`,
      { limitations: result.limitations, unknowns: result.unknowns },
      "INFERRED",
    ),
  ];

  const summaryText = [
    `采购单位：${criticalClaim(result, "buyer" as CriticalFactType, factById)}`,
    `编号：${criticalClaim(result, "tender_number" as CriticalFactType, factById)}`,
    `截标：${criticalClaim(result, "closing_datetime" as CriticalFactType, factById)}`,
    `约束条款：${mandatoryReqs.length} 项`,
    `风险：${result.risks.length} 项`,
    `待澄清：${result.clarifications.length} 项`,
  ].join("｜");

  // criticalFacts 解析为文本（避免存 V2 内存 factId → DB 悬空引用）
  const criticalFactsResolved: Record<string, { status: string; text: string | null }> = {};
  for (const [k, slot] of Object.entries(result.criticalFacts)) {
    criticalFactsResolved[k] =
      slot.status === "KNOWN"
        ? { status: "KNOWN", text: factById.get(slot.factId)?.claim ?? null }
        : { status: "UNKNOWN", text: null };
  }

  const buyerText = criticalClaim(result, "buyer" as CriticalFactType, factById);
  const productReqs = byCats("PRODUCT", "TECHNICAL");
  const unresolvedConflicts = result.conflicts.filter((c) => c.resolution === "UNRESOLVED");
  const blockers: string[] = [
    ...unresolvedConflicts.map((c) => `冲突：${c.topic}（${c.values.join(" ↔ ")}）`),
    ...result.risks.filter((r) => r.severity === "CRITICAL").map((r) => r.description),
    ...result.clarifications.filter((c) => c.priority === "BLOCKING").map((c) => c.question),
  ];

  // 简报就绪块：单一事实源，供 Executive Brief / 30 秒看懂 直接消费（deterministic projection）
  const brief = {
    oneLiner: result.projectSummary || null,
    buyer: buyerText === NA ? null : buyerText,
    product:
      productReqs.length > 0
        ? productReqs.slice(0, 3).map((r) => r.statement).join("；")
        : null,
    nextActions: result.nextActions,
    blockers,
    mandatoryCount: mandatoryReqs.length,
    riskCount: result.risks.length,
    clarificationCount: result.clarifications.length,
    unresolvedConflictCount: unresolvedConflicts.length,
    changeCount: result.addendumChanges.length,
  };

  const summaryJson: Record<string, unknown> = {
    engine: "v2",
    projectSummary: result.projectSummary,
    brief,
    criticalFacts: criticalFactsResolved,
    mandatoryRequirementIds: result.mandatoryRequirementIds,
    unknowns: result.unknowns,
    conflicts: result.conflicts,
    addendumChanges: result.addendumChanges,
    submissionChecklist: result.submissionChecklist,
    evidenceCoverage: result.evidenceCoverage,
    nextActions: result.nextActions,
    limitations: result.limitations,
    documentCount: result.manifest.documents.length,
    metadata: {
      analyzerVersion: result.metadata.analyzerVersion,
      models: result.metadata.models,
      llmCalls: result.metadata.llmCalls,
      llmFailures: result.metadata.llmFailures,
      pages: result.metadata.pages,
      windows: result.metadata.windows,
    },
  };

  return {
    facts,
    requirements,
    clarifications,
    changeCandidates,
    sections,
    summaryText,
    summaryJson,
  };
}
