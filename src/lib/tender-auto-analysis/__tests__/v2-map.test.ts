/**
 * Phase E — V2 结果 → 实体映射（纯函数）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/v2-map.test.ts
 */

import { mapV2Result, mapRunRoleToV2Role } from "../v2-map";
import { SECTION_KEYS } from "../constants";
import {
  CRITICAL_FACT_TYPES,
  type AnalysisResultV2,
  type CriticalFactSlotV2,
  type CriticalFactType,
} from "@/lib/tender-understanding/contract";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function criticalFacts(
  overrides: Partial<Record<CriticalFactType, CriticalFactSlotV2>>,
): Record<CriticalFactType, CriticalFactSlotV2> {
  const out = {} as Record<CriticalFactType, CriticalFactSlotV2>;
  for (const k of CRITICAL_FACT_TYPES) out[k] = { status: "UNKNOWN" };
  return { ...out, ...overrides };
}

const ev = (documentId: string, pageNumber: number, snippet: string) => ({
  documentId,
  pageNumber,
  snippet,
  quote: snippet,
});

const result: AnalysisResultV2 = {
  contractVersion: "tender-analysis-result-v2" as AnalysisResultV2["contractVersion"],
  manifest: { documents: [{ documentId: "d1", name: "Spec.pdf", sourceRole: "BASE_TENDER" }] } as AnalysisResultV2["manifest"],
  projectSummary: "Supply and install motorized roller shades.",
  criticalFacts: criticalFacts({
    buyer: { status: "KNOWN", factId: "f_buyer" },
    closing_datetime: { status: "KNOWN", factId: "f_close" },
    // tender_number 保持 UNKNOWN → 应显示（待核），不得编造
  }),
  facts: [
    {
      id: "f_buyer",
      factType: "buyer",
      claim: "Owner: Strathcona County",
      rawValue: "Strathcona County",
      normalizedValue: null,
      confidence: "HIGH",
      evidence: [ev("d1", 1, "Owner: Strathcona County")],
      sourceRole: "BASE_TENDER",
      status: "ACTIVE",
    },
    {
      id: "f_close",
      factType: "closing_datetime",
      claim: "Closes 2026-09-01 14:00",
      rawValue: "Sept 1 2026",
      normalizedValue: null,
      confidence: "MEDIUM",
      evidence: [ev("d1", 2, "Closing: September 1, 2026 14:00")],
      sourceRole: "BASE_TENDER",
      status: "ACTIVE",
    },
    {
      id: "f_super",
      factType: "other",
      claim: "Superseded value",
      rawValue: null,
      normalizedValue: null,
      confidence: "LOW",
      evidence: [ev("d1", 3, "old")],
      sourceRole: "BASE_TENDER",
      status: "SUPERSEDED",
    },
  ],
  requirements: [
    {
      id: "r1",
      category: "MANDATORY",
      statement: "Provide 5-year warranty on motors.",
      actor: null, action: null, object: null,
      mandatory: true, mandatorySignal: "shall", deadline: null, quantity: null, unit: null,
      submissionStage: null, technicalArea: null,
      status: "ACTIVE", supersededById: null,
      evidence: [ev("d1", 4, "5-year warranty")],
      confidence: "HIGH",
    },
    {
      id: "r2",
      category: "SUBMISSION",
      statement: "Submit shop drawings.",
      actor: null, action: null, object: null,
      mandatory: false, mandatorySignal: null, deadline: null, quantity: null, unit: null,
      submissionStage: null, technicalArea: null,
      status: "NEEDS_REVIEW", supersededById: null,
      evidence: [ev("d1", 5, "shop drawings")],
      confidence: "MEDIUM",
    },
    {
      id: "r3",
      category: "PRODUCT",
      statement: "Superseded requirement",
      actor: null, action: null, object: null,
      mandatory: false, mandatorySignal: null, deadline: null, quantity: null, unit: null,
      submissionStage: null, technicalArea: null,
      status: "SUPERSEDED", supersededById: "r1",
      evidence: [ev("d1", 6, "old req")],
      confidence: "LOW",
    },
  ],
  mandatoryRequirementIds: ["r1"],
  unknowns: [{ field: "tender_number", note: "not found in corpus" }],
  risks: [
    { id: "rk1", severity: "CRITICAL", riskType: "AMBIGUITY", description: "Motor voltage conflict", relatedRequirementIds: [], relatedFactIds: [], evidence: [], reasonCode: "conflict" },
  ],
  clarifications: [
    { id: "c1", question: "Confirm motor voltage (120V vs 24V)?", reason: "Spec/drawing disagree", priority: "BLOCKING", relatedRequirementIds: [], supportingEvidence: [ev("d1", 7, "120V ... 24V")], whatIsUnknown: "voltage", businessImpact: "wrong motor" },
  ],
  resolvedAmbiguities: [],
  addendumChanges: [
    { id: "a1", addendumDocumentId: "d2", action: "REPLACES", supersededRequirementId: "r3", activeRequirementId: "r1", note: "Rooms 201/203 changed to manual by Addendum 2", evidence: [ev("d2", 1, "now reads manual")] },
  ],
  conflicts: [
    { id: "x1", topic: "motor voltage", itemIds: ["f_a", "f_b"], values: ["120V", "24V"], resolution: "UNRESOLVED", note: "spec vs drawing" },
  ],
  submissionChecklist: [{ requirementId: "r2", statement: "Submit shop drawings." }],
  evidenceCoverage: { factsWithEvidence: 2, factsTotal: 2, requirementsWithEvidence: 2, requirementsTotal: 2 },
  limitations: ["window 3 failed"],
  nextActions: ["Confirm motor voltage with GC", "Request Somfy quote"],
  metadata: {
    analyzerVersion: "tender-understanding-v2" as AnalysisResultV2["metadata"]["analyzerVersion"],
    resultVersion: "tender-analysis-result-v2" as AnalysisResultV2["metadata"]["resultVersion"],
    projectId: "p1", startedAt: "", finishedAt: "", wallTimeMs: 0,
    llmCalls: 5, llmFailures: 1, models: ["m"], promptUsages: [], pages: 7, windows: 3,
    rejectedCandidates: [], inputChars: 0, outputChars: 0,
  },
};

console.log("tender-auto-analysis v2-map");

const m = mapV2Result(result);

// facts：仅 ACTIVE 入库（SUPERSEDED 排除），CONFIRMED_FACT + evidence
ok(m.facts.length === 2, "仅 2 条 ACTIVE facts（SUPERSEDED 排除）");
ok(m.facts.every((f) => f.statementKind === "CONFIRMED_FACT"), "facts statementKind=CONFIRMED_FACT");
ok(m.facts[0]!.sourceRefs.length === 1 && m.facts[0]!.sourceRefs[0]!.documentId === "d1", "fact 携带 source ref(documentId+page)");
ok(m.facts.find((f) => f.contentZh.includes("Strathcona"))?.confidence === "CONFIRMED", "HIGH→CONFIRMED 置信度映射");

// requirements：ACTIVE + NEEDS_REVIEW；NEEDS_REVIEW→NEEDS_CLARIFICATION；绝不 COMPLIANT
ok(m.requirements.length === 2, "2 条 requirements（ACTIVE+NEEDS_REVIEW，SUPERSEDED 排除）");
ok(m.requirements.find((r) => r.requirementCode === "r2")?.complianceStatus === "NEEDS_CLARIFICATION", "NEEDS_REVIEW → NEEDS_CLARIFICATION");
ok(m.requirements.every((r) => r.complianceStatus !== ("COMPLIANT" as unknown)), "绝不自动 COMPLIANT");
ok(m.requirements.find((r) => r.requirementCode === "r1")?.mandatory === true, "mandatory 保持");

// clarifications
ok(m.clarifications.length === 1 && m.clarifications[0]!.priority === "BLOCKING", "clarification 映射(优先级)");
ok(m.clarifications[0]!.sourceRefs.length === 1, "clarification 携带 evidence");

// addendum → change candidate（含 precedence）+ UNRESOLVED conflict → change candidate
const addendumChange = m.changeCandidates.find((c) => c.entityType === "requirement");
ok(!!addendumChange && addendumChange.summaryZh.includes("Addendum"), "addendum precedence → change candidate");
const conflictChange = m.changeCandidates.find((c) => c.entityType === "conflict");
ok(!!conflictChange && conflictChange.summaryZh.includes("未解决"), "UNRESOLVED 冲突 → change candidate（不自动择一）");

// 16 章节全覆盖
ok(m.sections.length === SECTION_KEYS.length, `覆盖全部 ${SECTION_KEYS.length} 章节`);
const covered = new Set(m.sections.map((s) => s.sectionKey));
ok(SECTION_KEYS.every((k) => covered.has(k)), "每个 SECTION_KEY 均有内容");

// grounded：tender_number 未知 → 待核，不编造
const projInfo = m.sections.find((s) => s.sectionKey === "PROJECT_INFORMATION");
ok(!!projInfo && projInfo.contentZh.includes("（待核）"), "缺失字段显示（待核），不编造");
ok(!!projInfo && projInfo.contentZh.includes("Strathcona"), "已知 buyer 落 PROJECT_INFORMATION");

// mandatory 章节含 warranty；风险章节含冲突
ok(m.sections.find((s) => s.sectionKey === "MANDATORY_REQUIREMENTS")!.contentZh.includes("warranty"), "强制要求含 5-year warranty");
ok(m.sections.find((s) => s.sectionKey === "RISKS")!.contentZh.includes("Motor voltage") || m.sections.find((s) => s.sectionKey === "RISKS")!.contentZh.includes("motor voltage"), "风险章节含电压冲突");

// summary
ok(m.summaryText.includes("Strathcona"), "summaryText 含采购单位");
ok((m.summaryJson as { engine?: string }).engine === "v2", "summaryJson.engine=v2");
ok(Array.isArray((m.summaryJson as { nextActions?: unknown }).nextActions), "summaryJson 携带 nextActions(grounded)");

// role map
ok(mapRunRoleToV2Role("ADDENDUM") === "ADDENDUM", "role map ADDENDUM");
ok(mapRunRoleToV2Role("PRIMARY") === "BASE_TENDER", "role map PRIMARY→BASE_TENDER");
ok(mapRunRoleToV2Role("weird") === "OTHER", "role map 未知→OTHER");

console.log(`\nv2-map: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
