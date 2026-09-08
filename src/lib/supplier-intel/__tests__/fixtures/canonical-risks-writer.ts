/**
 * R2 正常路径夹具：**复用真实 writer 契约**产出 RISKS.structuredJson。
 *
 * 不手写「看起来合理」的 risks 对象——这里调用 canonical 的 deriveRisks（risks.ts，
 * MANDATORY_UNCERTAIN 聚合与 .slice(0,12) 封顶的唯一产地），再包成 v2-map.ts 落库时
 * 的形状 `{ risks, conflicts }`。因此夹具与生产写路径同源：writer 改了聚合语义，
 * 夹具会跟着变，测试随即暴露。
 */
import { CRITICAL_FACT_TYPES } from "@/lib/tender-understanding/contract";
import type {
  CriticalFactSlotV2,
  CriticalFactType,
  MandatoryV2,
  RequirementStatusV2,
  TenderRequirementV2,
} from "@/lib/tender-understanding/contract";
import { deriveRisks } from "@/lib/tender-understanding/risks";

export interface RequirementSpec {
  code: string;
  mandatory: MandatoryV2;
  statement?: string;
  status?: RequirementStatusV2;
}

function requirementOf(spec: RequirementSpec): TenderRequirementV2 {
  return {
    id: spec.code,
    category: "TECHNICAL",
    statement: spec.statement ?? `requirement ${spec.code}`,
    actor: null,
    action: null,
    object: null,
    mandatory: spec.mandatory,
    mandatorySignal: spec.mandatory === true ? "must" : null,
    deadline: null,
    quantity: null,
    unit: null,
    submissionStage: null,
    technicalArea: null,
    status: spec.status ?? "ACTIVE",
    supersededById: null,
    evidence: [],
    confidence: "HIGH",
  };
}

/** v2-map.ts 写进 TenderAnalysisSection(RISKS).structuredJson 的真实形状 */
export function buildCanonicalRisksStructuredJson(specs: RequirementSpec[]): {
  risks: unknown[];
  conflicts: unknown[];
} {
  const criticalFacts = Object.fromEntries(
    CRITICAL_FACT_TYPES.map((t) => [t, { status: "UNKNOWN" } as CriticalFactSlotV2]),
  ) as Record<CriticalFactType, CriticalFactSlotV2>;

  const risks = deriveRisks({
    verifiedRiskCandidates: [],
    requirements: specs.map(requirementOf),
    facts: [],
    criticalFacts,
    conflicts: [],
    clarifications: [],
    rejectedTally: [],
  });
  return { risks, conflicts: [] };
}

/** 便捷：真实 writer 产出的 MANDATORY_UNCERTAIN 聚合（不存在时返回 null） */
export function uncertainAggregateOf(structuredJson: {
  risks: unknown[];
}): { relatedRequirementIds: string[] } | null {
  const hit = (structuredJson.risks as Array<Record<string, unknown>>).find(
    (r) => r.reasonCode === "MANDATORY_UNCERTAIN",
  );
  if (!hit) return null;
  return { relatedRequirementIds: hit.relatedRequirementIds as string[] };
}
