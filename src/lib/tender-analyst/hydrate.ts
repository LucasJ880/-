/**
 * hydrateEvidenceIndex（§6/§18）— supporting ID → 既有 canonical 证据
 *
 * Analyst 只输出 ID；server 在此把每个被引用的实体解析为
 * { 原文陈述, [document/page/snippet…] }，供 Evidence Drawer 展示。
 * 纯函数：只读 AnalysisResultV2，绝不发明证据。
 */

import type { AnalysisResultV2 } from "@/lib/tender-understanding/contract";
import type { AnalystEvidenceRef, AnalystLlmOutput } from "./contract";

export function collectReferencedIds(synthesis: AnalystLlmOutput): Set<string> {
  const ids = new Set<string>();
  const addAll = (arr: string[]) => arr.forEach((x) => ids.add(x));
  for (const item of [
    ...synthesis.keyRequirements,
    ...synthesis.technicalRequirements,
    ...synthesis.commercialAndDelivery,
  ]) {
    addAll(item.supportingRequirementIds);
    addAll(item.supportingFactIds);
    addAll(item.supportingRiskIds);
  }
  for (const r of synthesis.risksAndGaps) addAll(r.supportingIds);
  for (const c of synthesis.clarifications) {
    addAll(c.clarificationIds);
    addAll(c.supportingIds);
  }
  return ids;
}

export function hydrateEvidenceIndex(
  synthesis: AnalystLlmOutput,
  result: AnalysisResultV2,
  /** (documentId, 单元序号) → 单元标签；非 PDF 证据据此展示真实定位而非"第 N 页" */
  unitLabelOf?: (documentId: string, pageNumber: number | null) => string | null,
): Record<string, AnalystEvidenceRef> {
  const nameByDoc = new Map(
    result.manifest.documents.map((d) => [d.documentId, d.name] as const),
  );
  const evOf = (
    evidence: Array<{ documentId: string; pageNumber?: number | null; snippet?: string | null }>,
  ) =>
    evidence.map((e) => ({
      documentId: e.documentId,
      documentName: nameByDoc.get(e.documentId) ?? null,
      pageNumber: e.pageNumber ?? null,
      unitLabel: unitLabelOf?.(e.documentId, e.pageNumber ?? null) ?? null,
      snippet: e.snippet ? e.snippet.slice(0, 400) : null,
    }));

  const index: Record<string, AnalystEvidenceRef> = {};
  const wanted = collectReferencedIds(synthesis);

  for (const r of result.requirements) {
    if (!wanted.has(r.id)) continue;
    index[r.id] = {
      kind: "requirement",
      entityId: r.id,
      statement: r.statement,
      evidence: evOf(r.evidence),
    };
  }
  for (const f of result.facts) {
    if (!wanted.has(f.id)) continue;
    index[f.id] = {
      kind: "fact",
      entityId: f.id,
      statement: f.claim,
      evidence: evOf(f.evidence),
    };
  }
  for (const r of result.risks) {
    if (!wanted.has(r.id)) continue;
    index[r.id] = {
      kind: "risk",
      entityId: r.id,
      statement: r.description,
      evidence: evOf(r.evidence),
    };
  }
  for (const c of result.clarifications) {
    if (!wanted.has(c.id)) continue;
    index[c.id] = {
      kind: "clarification",
      entityId: c.id,
      statement: c.question,
      evidence: evOf(c.supportingEvidence),
    };
  }
  return index;
}
