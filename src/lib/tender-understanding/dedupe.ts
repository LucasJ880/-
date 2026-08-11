/**
 * 语义去重 + 业务对象定型
 *
 * - Requirement 去重不做 string equality：statement 指纹 + token Jaccard。
 * - 同一 requirement 跨文档（Base/Spec/Form）重复 → 业务上一条，EvidenceRefs 合并保留全部。
 * - 合并时 statement 取信息量更高（更长）的表述；mandatory 冲突 → 取更强断言但
 *   true 与 false 并存时 → "uncertain"（不得静默择一）。
 */

import type {
  AnalyzerInput,
  DocumentFactV2,
  DocumentSourceRole,
  EvidenceRefV2,
  FactCandidateV2,
  MandatoryV2,
  RequirementCandidateV2,
  TenderRequirementV2,
} from "./contract";
import {
  normalizeFactValue,
  statementFingerprint,
  tokenJaccard,
} from "./normalize";

export const REQUIREMENT_DUPLICATE_JACCARD = 0.62;

function evidenceOf(c: {
  sourceDocumentId: string;
  pageNumber: number;
  sourceSnippet: string;
}): EvidenceRefV2 {
  return {
    documentId: c.sourceDocumentId,
    pageNumber: c.pageNumber,
    snippet: c.sourceSnippet.slice(0, 600),
  };
}

function mergeEvidence(base: EvidenceRefV2[], extra: EvidenceRefV2): EvidenceRefV2[] {
  const key = (e: EvidenceRefV2) =>
    `${e.documentId}:${e.pageNumber}:${e.snippet.slice(0, 60)}`;
  const seen = new Set(base.map(key));
  if (seen.has(key(extra))) return base;
  return [...base, extra];
}

function mergeMandatory(a: MandatoryV2, b: MandatoryV2): MandatoryV2 {
  if (a === b) return a;
  if ((a === true && b === false) || (a === false && b === true)) return "uncertain";
  // true + uncertain → true 需谨慎：证据一处明确一处不明 → 保留 true（已过 signal 验证）
  if (a === true || b === true) return true;
  return "uncertain";
}

const CONFIDENCE_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

/* ---------------------------------- Requirements ---------------------------------- */

export type MergedRequirement = {
  requirement: TenderRequirementV2;
  members: RequirementCandidateV2[];
};

export function dedupeRequirements(
  input: AnalyzerInput,
  candidates: RequirementCandidateV2[],
): MergedRequirement[] {
  const roleOf = new Map<string, DocumentSourceRole>(
    input.documents.map((d) => [d.documentId, d.sourceRole]),
  );

  type Group = {
    fingerprint: string;
    members: RequirementCandidateV2[];
  };
  const groups: Group[] = [];

  for (const c of candidates) {
    const fp = statementFingerprint(c.statement);
    let placed = false;
    for (const g of groups) {
      const representative = g.members[0]!;
      if (
        g.fingerprint === fp ||
        (representative.category === c.category &&
          tokenJaccard(representative.statement, c.statement) >=
            REQUIREMENT_DUPLICATE_JACCARD)
      ) {
        g.members.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ fingerprint: fp, members: [c] });
  }

  return groups.map((g, i) => {
    const id = `R-${String(i + 1).padStart(3, "0")}`;
    // 表述取最长（信息量代理）；base 文档优先作为主证据顺序
    const sorted = [...g.members].sort((a, b) => {
      const roleA = roleOf.get(a.sourceDocumentId) === "ADDENDUM" ? 1 : 0;
      const roleB = roleOf.get(b.sourceDocumentId) === "ADDENDUM" ? 1 : 0;
      if (roleA !== roleB) return roleA - roleB;
      return b.statement.length - a.statement.length;
    });
    const primary = sorted[0]!;
    let mandatory: MandatoryV2 = primary.mandatory;
    let evidence: EvidenceRefV2[] = [];
    let confidence = primary.confidence;
    for (const m of g.members) {
      mandatory = m === primary ? mandatory : mergeMandatory(mandatory, m.mandatory);
      evidence = mergeEvidence(evidence, evidenceOf(m));
      if (CONFIDENCE_ORDER[m.confidence] > CONFIDENCE_ORDER[confidence]) {
        confidence = m.confidence;
      }
    }
    const requirement: TenderRequirementV2 = {
      id,
      category: primary.category,
      statement: primary.statement,
      actor: primary.actor,
      action: primary.action,
      object: primary.object,
      mandatory,
      mandatorySignal: primary.mandatorySignal,
      deadline: primary.deadline,
      quantity: primary.quantity,
      unit: primary.unit,
      submissionStage: primary.submissionStage,
      technicalArea: primary.technicalArea,
      status: "ACTIVE",
      supersededById: null,
      evidence,
      confidence,
    };
    return { requirement, members: g.members };
  });
}

/* ---------------------------------- Facts ---------------------------------- */

export function dedupeFacts(
  input: AnalyzerInput,
  candidates: FactCandidateV2[],
): DocumentFactV2[] {
  const roleOf = new Map<string, DocumentSourceRole>(
    input.documents.map((d) => [d.documentId, d.sourceRole]),
  );

  type Group = { members: FactCandidateV2[] };
  const groups: Group[] = [];
  for (const c of candidates) {
    let placed = false;
    for (const g of groups) {
      const rep = g.members[0]!;
      if (
        rep.factType === c.factType &&
        (rep.factType !== "other" ||
          tokenJaccard(rep.claim, c.claim) >= REQUIREMENT_DUPLICATE_JACCARD)
      ) {
        // 同 factType：值一致才并组；值不同留给 precedence/conflict 处理
        const normA = normalizeFactValue(rep.factType, rep.rawValue, rep.claim);
        const normB = normalizeFactValue(c.factType, c.rawValue, c.claim);
        const same =
          JSON.stringify(normA) === JSON.stringify(normB) ||
          tokenJaccard(rep.claim, c.claim) >= REQUIREMENT_DUPLICATE_JACCARD;
        if (same) {
          g.members.push(c);
          placed = true;
          break;
        }
      }
    }
    if (!placed) groups.push({ members: [c] });
  }

  return groups.map((g, i) => {
    const sorted = [...g.members].sort(
      (a, b) => CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence],
    );
    const primary = sorted[0]!;
    let evidence: EvidenceRefV2[] = [];
    for (const m of g.members) evidence = mergeEvidence(evidence, evidenceOf(m));
    return {
      id: `F-${String(i + 1).padStart(3, "0")}`,
      factType: primary.factType,
      claim: primary.claim,
      rawValue: primary.rawValue,
      normalizedValue: normalizeFactValue(
        primary.factType,
        primary.rawValue,
        primary.claim,
      ),
      confidence: primary.confidence,
      evidence,
      sourceRole: roleOf.get(primary.sourceDocumentId) ?? "OTHER",
      status: "ACTIVE" as const,
    };
  });
}
