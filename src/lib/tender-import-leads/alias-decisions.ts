/**
 * CHAIN-3c 「是不是同一家」的裁决与撤回：从审计行算出每对的有效裁决（纯函数）
 *
 * 裁决行：action = tender.import_lead_alias_decided，afterData 是 AliasDecision。
 * 撤回行：action = tender.import_lead_alias_revoked，beforeData 是原裁决，afterData = { pairKey, revokedAuditId, revokedBy, revokedAt }。
 */
import type { AliasDecision } from "@/lib/tender-competition/company-identity";

export const IMPORT_LEAD_ALIAS_AUDIT_ACTION = "tender.import_lead_alias_decided";
/** 撤回一条裁决（afterData.revokedAuditId 指向被撤回的那条裁决审计行） */
export const IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION = "tender.import_lead_alias_revoked";

export function parseDecision(afterData: string | null, pairKey: string): AliasDecision | null {
  try {
    const d = JSON.parse(afterData ?? "") as Partial<AliasDecision>;
    if (d.pairKey !== pairKey || (d.decision !== "CONFIRMED" && d.decision !== "REJECTED")) return null;
    return { pairKey: d.pairKey, nameA: String(d.nameA ?? ""), nameB: String(d.nameB ?? ""), decision: d.decision, decidedBy: String(d.decidedBy ?? ""), decidedAt: String(d.decidedAt ?? "") };
  } catch {
    return null;
  }
}

/** CHAIN-3c：带审计行 id 的有效裁决（撤回请求要带上这个 id） */
export type EffectiveDecision = AliasDecision & { auditId: string };

export type AliasAuditRow = { id: string; action: string; targetId: string | null; afterData: string | null; createdAt: Date };

/**
 * CHAIN-3c：一组裁决 / 撤回审计行 → 每对的有效裁决。
 * 被撤回行的 afterData.revokedAuditId 指向的裁决行无效；剩下的里取每对最新的一条（正常情况下每对最多一条：裁决与撤回同一把锁）。
 * 不靠撤回行与裁决行的时间先后（应用进程取时间，多实例时钟有偏差）。
 */
export function effectiveDecisions(rows: readonly AliasAuditRow[], pairKeyOfTarget: ReadonlyMap<string, string>): EffectiveDecision[] {
  const revoked = new Set<string>();
  for (const r of rows) {
    if (r.action !== IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION) continue;
    try {
      const a = JSON.parse(r.afterData ?? "") as { revokedAuditId?: unknown };
      if (typeof a.revokedAuditId === "string") revoked.add(a.revokedAuditId);
    } catch {
      /* 形状不对的撤回行不算 */
    }
  }
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const out = new Map<string, EffectiveDecision>();
  for (const r of sorted) {
    if (r.action !== IMPORT_LEAD_ALIAS_AUDIT_ACTION || revoked.has(r.id)) continue;
    const pairKey = r.targetId ? pairKeyOfTarget.get(r.targetId) : undefined;
    if (!pairKey || out.has(pairKey)) continue;
    const d = parseDecision(r.afterData, pairKey);
    if (d) out.set(pairKey, { ...d, auditId: r.id });
  }
  return [...out.values()];
}
