/**
 * Synthesis — 只组装已验证数据，不自由发挥
 *
 * 输入只能来自 verified Facts / Requirements / Risks / Unknowns / Clarifications；
 * Synthesis 不新增任何此前不存在的 requirement / fact（spec §35）。
 * projectSummary 为确定性拼装（含显式 UNKNOWN），不经 LLM 自由生成。
 */

import type {
  AddendumChangeV2,
  AnalysisResultV2,
  ClarificationV2,
  ConflictV2,
  CriticalFactSlotV2,
  CriticalFactType,
  DocumentFactV2,
  DocumentManifest,
  RiskV2,
  TenderRequirementV2,
  UnknownV2,
} from "./contract";
import { CRITICAL_FACT_TYPES } from "./contract";

const CONFIDENCE_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

export function assembleCriticalFacts(
  facts: DocumentFactV2[],
): Record<CriticalFactType, CriticalFactSlotV2> {
  const slots = {} as Record<CriticalFactType, CriticalFactSlotV2>;
  for (const slot of CRITICAL_FACT_TYPES) {
    const candidates = facts.filter(
      (f) => f.factType === slot && f.status === "ACTIVE",
    );
    if (candidates.length === 0) {
      slots[slot] = { status: "UNKNOWN" };
      continue;
    }
    const best = [...candidates].sort(
      (a, b) =>
        CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence] ||
        b.evidence.length - a.evidence.length,
    )[0]!;
    slots[slot] = { status: "KNOWN", factId: best.id };
  }
  return slots;
}

export function buildUnknowns(
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>,
  conflictedFactTypes: string[],
): UnknownV2[] {
  const unknowns: UnknownV2[] = [];
  for (const slot of CRITICAL_FACT_TYPES) {
    if (criticalFacts[slot].status === "UNKNOWN") {
      unknowns.push({
        field: slot,
        note: conflictedFactTypes.includes(slot)
          ? "文档集存在相互矛盾的取值，未解决前按 UNKNOWN 处理"
          : "文档集中未找到该信息（UNKNOWN 是合法结果，不得默认值填充）",
      });
    }
  }
  return unknowns;
}

const SUBMISSION_CATEGORIES = new Set([
  "SUBMISSION",
  "ADMINISTRATIVE",
  "PRICING",
  "SAMPLES",
  "SHOP_DRAWINGS",
  "BONDING",
  "INSURANCE",
]);

export function buildSubmissionChecklist(
  requirements: TenderRequirementV2[],
): { requirementId: string; statement: string }[] {
  return requirements
    .filter(
      (r) =>
        r.status === "ACTIVE" &&
        r.mandatory === true &&
        SUBMISSION_CATEGORIES.has(r.category),
    )
    .map((r) => ({ requirementId: r.id, statement: r.statement }));
}

export function buildProjectSummary(
  facts: DocumentFactV2[],
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>,
  requirements: TenderRequirementV2[],
  clarifications: ClarificationV2[],
  conflicts: ConflictV2[],
): string {
  const factById = new Map(facts.map((f) => [f.id, f]));
  const val = (slot: CriticalFactType): string => {
    const s = criticalFacts[slot];
    if (s.status === "UNKNOWN") return "UNKNOWN";
    const f = factById.get(s.factId);
    return f ? (f.rawValue ?? f.claim) : "UNKNOWN";
  };
  const mandatoryCount = requirements.filter(
    (r) => r.status === "ACTIVE" && r.mandatory === true,
  ).length;
  const activeCount = requirements.filter((r) => r.status === "ACTIVE").length;
  return [
    `买方：${val("buyer")}；项目：${val("project_title")}；招标编号：${val("tender_number")}。`,
    `截标：${val("closing_datetime")}；提交方式：${val("submission_method")}；询问截止：${val("question_deadline")}。`,
    `范围：${val("scope")}；数量：${val("quantity")}；合同期：${val("contract_duration")}。`,
    `已验证要求 ${activeCount} 条（其中 mandatory ${mandatoryCount} 条）；未解决矛盾 ${conflicts.filter((c) => c.resolution === "UNRESOLVED").length} 项；建议澄清 ${clarifications.length} 条。`,
    `本摘要仅由已验证事实拼装；UNKNOWN 表示文档集中未找到，不代表不存在。`,
  ].join("\n");
}

export function assembleResult(parts: {
  manifest: DocumentManifest;
  facts: DocumentFactV2[];
  requirements: TenderRequirementV2[];
  risks: RiskV2[];
  clarifications: ClarificationV2[];
  resolvedAmbiguities: AnalysisResultV2["resolvedAmbiguities"];
  addendumChanges: AddendumChangeV2[];
  conflicts: ConflictV2[];
  metadata: AnalysisResultV2["metadata"];
  limitations: string[];
}): AnalysisResultV2 {
  const criticalFacts = assembleCriticalFacts(parts.facts);
  const conflictedFactTypes = parts.facts
    .filter((f) => f.status === "CONFLICT")
    .map((f) => f.factType);
  const unknowns = buildUnknowns(criticalFacts, conflictedFactTypes);
  const mandatoryRequirementIds = parts.requirements
    .filter((r) => r.status === "ACTIVE" && r.mandatory === true)
    .map((r) => r.id);

  const nextActions: string[] = [];
  if (parts.conflicts.some((c) => c.resolution === "UNRESOLVED")) {
    nextActions.push("人工复核未解决矛盾（conflicts），确认有效版本。");
  }
  if (parts.clarifications.length > 0) {
    nextActions.push(
      `在询问截止前向业主发出 ${parts.clarifications.length} 条澄清问题。`,
    );
  }
  if (unknowns.length > 0) {
    nextActions.push(
      `复核 ${unknowns.length} 个 UNKNOWN 槽位：或文档确实未写，或需补充文档。`,
    );
  }
  nextActions.push("人工审核 mandatory 清单后再进入合规矩阵 / 报价。");

  return {
    contractVersion: "tender-analysis-result/v2",
    manifest: parts.manifest,
    projectSummary: buildProjectSummary(
      parts.facts,
      criticalFacts,
      parts.requirements,
      parts.clarifications,
      parts.conflicts,
    ),
    criticalFacts,
    facts: parts.facts,
    requirements: parts.requirements,
    mandatoryRequirementIds,
    unknowns,
    risks: parts.risks,
    clarifications: parts.clarifications,
    resolvedAmbiguities: parts.resolvedAmbiguities,
    addendumChanges: parts.addendumChanges,
    conflicts: parts.conflicts,
    submissionChecklist: buildSubmissionChecklist(parts.requirements),
    evidenceCoverage: {
      factsWithEvidence: parts.facts.filter((f) => f.evidence.length > 0).length,
      factsTotal: parts.facts.length,
      requirementsWithEvidence: parts.requirements.filter(
        (r) => r.evidence.length > 0,
      ).length,
      requirementsTotal: parts.requirements.length,
    },
    limitations: parts.limitations,
    nextActions,
    metadata: parts.metadata,
  };
}
