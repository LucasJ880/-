/**
 * CHAIN-2 — 情报推荐并入自动起草收件人的合并规则（纯函数，判断点 4 B）
 *
 * 推荐 = 本项目推荐排名里分区为主选 / 备选、强制闸通过的候选所属供应商（按名次，同一家只算一次）。
 * 并入规则：操作者自己的名单在前（顺序不变），推荐补在后面；已在名单里的不重复；
 * 只并入在用且有邮箱的；合计最多 8 家（与自动起草的上限相同）。
 */

export const INTEL_RECIPIENTS_MAX = 8;

export type RankedForRecipients = { supplierId: string; section: string; rank: number | null; mandatoryGateResult: string };
export type SupplierRow = { id: string; name: string; contactEmail: string | null; status: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 排名 → 推荐的供应商 id（主选 / 备选、强制闸通过，按名次，去重） */
export function intelRecommendedSupplierIds(ranked: readonly RankedForRecipients[]): string[] {
  const out: string[] = [];
  const rows = ranked
    .filter((r) => (r.section === "PRIMARY" || r.section === "BACKUP") && r.mandatoryGateResult === "PASS")
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  for (const r of rows) if (!out.includes(r.supplierId)) out.push(r.supplierId);
  return out;
}

/**
 * picked：操作者名单里已就绪的（已按保存顺序、已截到上限）；intelOrdered：推荐的供应商行（按名次）。
 * 返回合并后的收件人与其中来自推荐的那几家。
 */
export function mergeIntelRecipients(input: { picked: ReadonlyArray<{ id: string; name: string }>; intelOrdered: readonly SupplierRow[]; max?: number }): {
  merged: Array<{ id: string; name: string }>;
  intelAdded: Array<{ id: string; name: string }>;
} {
  const max = input.max ?? INTEL_RECIPIENTS_MAX;
  const merged = input.picked.slice(0, max);
  const intelAdded: Array<{ id: string; name: string }> = [];
  for (const s of input.intelOrdered) {
    if (merged.length >= max) break;
    if (merged.some((m) => m.id === s.id)) continue;
    if (s.status !== "active" || !s.contactEmail || !EMAIL_RE.test(s.contactEmail.trim())) continue;
    merged.push({ id: s.id, name: s.name });
    intelAdded.push({ id: s.id, name: s.name });
  }
  return { merged, intelAdded };
}

/** 「其中 N 家来自供应商情报推荐：甲、乙」；没有并入时为空串 */
export function intelRecipientsNoteZh(names: readonly string[]): string {
  return names.length ? `其中 ${names.length} 家来自供应商情报推荐：${names.join("、")}` : "";
}
