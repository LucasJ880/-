/**
 * buildTenderAnalystContext — AnalysisResultV2 → compact Analyst 上下文（§7）
 *
 * 不把 raw PDF pages 再塞给 synthesis；压缩文本但绝不丢：
 * entity ID、category、stage、mandatory/mandatorySignal、confidence、来源关系。
 * 纯函数，无 IO。
 */

import type { AnalysisResultV2 } from "@/lib/tender-understanding/contract";

const clip = (s: string | null | undefined, max: number): string | null => {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

export type TenderAnalystContext = {
  manifest: Array<{
    documentId: string;
    name: string;
    sourceRole: string;
    pageCount: number | null;
  }>;
  criticalFacts: Record<string, { status: string; factId?: string }>;
  facts: Array<{
    id: string;
    factType: string;
    claim: string;
    confidence: string;
    docIds: string[];
  }>;
  requirements: Array<{
    id: string;
    category: string;
    statement: string;
    mandatory: boolean | "uncertain";
    mandatorySignal: string | null;
    submissionStage: string | null;
    deadline: string | null;
    quantity: string | null;
    status: string;
    confidence: string;
    docIds: string[];
    pages: number[];
  }>;
  risks: Array<{
    id: string;
    severity: string;
    riskType: string;
    description: string;
    relatedRequirementIds: string[];
    relatedFactIds: string[];
  }>;
  clarifications: Array<{
    id: string;
    priority: string;
    question: string;
    reason: string;
    whatIsUnknown: string;
    businessImpact: string;
    relatedRequirementIds: string[];
  }>;
  conflicts: Array<{
    id: string;
    topic: string;
    values: string[];
    resolution: string;
    itemIds: string[];
  }>;
  unknowns: Array<{ field: string; note: string }>;
  addendumChanges: Array<{ id: string; action: string; note: string }>;
  submissionChecklist: Array<{ requirementId: string; statement: string }>;
  limitations: string[];
  projectSummary: string | null;
};

export function buildTenderAnalystContext(
  result: AnalysisResultV2,
): TenderAnalystContext {
  const activeReqs = result.requirements.filter(
    (r) => r.status === "ACTIVE" || r.status === "NEEDS_REVIEW",
  );
  return {
    manifest: result.manifest.documents.map((d) => ({
      documentId: d.documentId,
      name: d.name,
      sourceRole: d.sourceRole,
      pageCount: d.pageCount ?? null,
    })),
    criticalFacts: Object.fromEntries(
      Object.entries(result.criticalFacts).map(([k, slot]) => [
        k,
        slot.status === "KNOWN"
          ? { status: "KNOWN", factId: slot.factId }
          : { status: "UNKNOWN" },
      ]),
    ),
    facts: result.facts
      .filter((f) => f.status === "ACTIVE")
      .map((f) => ({
        id: f.id,
        factType: f.factType,
        claim: clip(f.claim, 280) ?? "",
        confidence: f.confidence,
        docIds: [...new Set(f.evidence.map((e) => e.documentId))],
      })),
    requirements: activeReqs.map((r) => ({
      id: r.id,
      category: r.category,
      statement: clip(r.statement, 320) ?? "",
      mandatory: r.mandatory,
      mandatorySignal: clip(r.mandatorySignal, 160),
      submissionStage: r.submissionStage,
      deadline: r.deadline,
      quantity: r.quantity,
      status: r.status,
      confidence: r.confidence,
      docIds: [...new Set(r.evidence.map((e) => e.documentId))],
      pages: [
        ...new Set(
          r.evidence
            .map((e) => e.pageNumber)
            .filter((p): p is number => typeof p === "number"),
        ),
      ],
    })),
    risks: result.risks.map((r) => ({
      id: r.id,
      severity: r.severity,
      riskType: r.riskType,
      description: clip(r.description, 320) ?? "",
      relatedRequirementIds: r.relatedRequirementIds,
      relatedFactIds: r.relatedFactIds,
    })),
    clarifications: result.clarifications.map((c) => ({
      id: c.id,
      priority: c.priority,
      question: clip(c.question, 280) ?? "",
      reason: clip(c.reason, 240) ?? "",
      whatIsUnknown: clip(c.whatIsUnknown, 200) ?? "",
      businessImpact: clip(c.businessImpact, 200) ?? "",
      relatedRequirementIds: c.relatedRequirementIds,
    })),
    conflicts: result.conflicts.map((c) => ({
      id: c.id,
      topic: c.topic,
      values: c.values.map((v) => clip(v, 120) ?? ""),
      resolution: c.resolution,
      itemIds: c.itemIds,
    })),
    unknowns: result.unknowns.map((u) => ({
      field: String(u.field),
      note: clip(u.note, 200) ?? "",
    })),
    addendumChanges: result.addendumChanges.map((a) => ({
      id: a.id,
      action: a.action,
      note: clip(a.note, 240) ?? "",
    })),
    submissionChecklist: result.submissionChecklist.map((s) => ({
      requirementId: s.requirementId,
      statement: clip(s.statement, 200) ?? "",
    })),
    limitations: result.limitations.map((l) => clip(l, 200) ?? ""),
    projectSummary: clip(result.projectSummary, 800),
  };
}
