/**
 * 合规记忆 · 匹配（纯函数）：把当前 run 的要求与组织历史确认（claims）对齐。
 * exact = 指纹一致（自动带入）；fuzzy = Jaccard ≥ 阈值（作为建议，一键采纳）。
 */

import {
  COMPLIANCE_MEMORY_FUZZY_THRESHOLD,
  COMPLIANCE_MEMORY_SUBJECT_PREFIX,
  jaccard,
  requirementFingerprint,
  requirementTokens,
} from "./fingerprint";

export type CompliancePosition = {
  claimId: string;
  fingerprint: string;
  textSample: string;
  category: string | null;
  fit: string;
  noteZh: string | null;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  sourceRequirementCode: string | null;
  confirmedAt: string | null;
};

export type MemorySuggestion = CompliancePosition & {
  requirementId: string;
  kind: "exact" | "fuzzy";
  score: number;
};

/** 从 T3 claim 的 structuredValue 还原合规立场（坏形 → null，不抛） */
export function positionFromClaim(claim: {
  id: string;
  subjectKey: string;
  structuredValue: unknown;
  capturedAt?: Date | string | null;
}): CompliancePosition | null {
  const v = claim.structuredValue as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  const fit = typeof v.fit === "string" ? v.fit : null;
  const textSample = typeof v.textSample === "string" ? v.textSample : null;
  if (!fit || !textSample) return null;
  const fp =
    typeof v.fingerprint === "string"
      ? v.fingerprint
      : claim.subjectKey.startsWith(COMPLIANCE_MEMORY_SUBJECT_PREFIX)
        ? claim.subjectKey.slice(COMPLIANCE_MEMORY_SUBJECT_PREFIX.length)
        : requirementFingerprint(textSample);
  return {
    claimId: claim.id,
    fingerprint: fp,
    textSample,
    category: typeof v.category === "string" ? v.category : null,
    fit,
    noteZh: typeof v.noteZh === "string" ? v.noteZh : null,
    sourceProjectId: typeof v.sourceProjectId === "string" ? v.sourceProjectId : null,
    sourceProjectName: typeof v.sourceProjectName === "string" ? v.sourceProjectName : null,
    sourceRequirementCode: typeof v.sourceRequirementCode === "string" ? v.sourceRequirementCode : null,
    confirmedAt:
      claim.capturedAt instanceof Date
        ? claim.capturedAt.toISOString()
        : typeof claim.capturedAt === "string"
          ? claim.capturedAt
          : null,
  };
}

export function matchRequirementsToMemory(
  requirements: Array<{ id: string; text: string; category?: string | null }>,
  positions: CompliancePosition[],
  opts: { fuzzyThreshold?: number; excludeProjectId?: string | null } = {},
): MemorySuggestion[] {
  const threshold = opts.fuzzyThreshold ?? COMPLIANCE_MEMORY_FUZZY_THRESHOLD;
  const byFp = new Map<string, CompliancePosition>();
  const pool: Array<{ p: CompliancePosition; tokens: Set<string> }> = [];
  for (const p of positions) {
    if (opts.excludeProjectId && p.sourceProjectId === opts.excludeProjectId) continue;
    if (!byFp.has(p.fingerprint)) byFp.set(p.fingerprint, p);
    pool.push({ p, tokens: requirementTokens(p.textSample) });
  }
  const out: MemorySuggestion[] = [];
  for (const r of requirements) {
    const fp = requirementFingerprint(r.text);
    const exact = byFp.get(fp);
    if (exact) {
      out.push({ ...exact, requirementId: r.id, kind: "exact", score: 1 });
      continue;
    }
    const tokens = requirementTokens(r.text);
    let best: { p: CompliancePosition; score: number } | null = null;
    for (const cand of pool) {
      const s = jaccard(tokens, cand.tokens);
      if (s >= threshold && (!best || s > best.score)) best = { p: cand.p, score: s };
    }
    if (best) out.push({ ...best.p, requirementId: r.id, kind: "fuzzy", score: Math.round(best.score * 100) / 100 });
  }
  return out;
}
