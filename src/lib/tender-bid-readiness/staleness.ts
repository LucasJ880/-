/**
 * TI-3b 补遗使旧结论失效（纯函数）
 *
 * 每条结论记下它基于哪一版补遗（0 = 原始文件）与涉及的行。影响该行的最新补遗号大于它，
 * 这条结论就待复核。只按「行 + 版本」判断，不解析补遗正文；哪份补遗影响哪些行由上游给出。
 */

export const DEPENDENT_KINDS = ["SUPPLIER_MATCH", "COST_ASSUMPTION", "DIMENSION_MATCH", "CERTIFICATION"] as const;
export type DependentKind = (typeof DEPENDENT_KINDS)[number];
export const DEPENDENT_KIND_ZH: Record<DependentKind, string> = {
  SUPPLIER_MATCH: "供应商匹配", COST_ASSUMPTION: "成本假设", DIMENSION_MATCH: "尺寸对照", CERTIFICATION: "认证判定",
};

export type Addendum = { number: number; issuedOn?: string | null; affectedLineNos: number[]; effect?: string | null };
export type DependentConclusion = { key: string; kind: DependentKind; lineNo: number; basedOnAddendum: number };
export type StaleConclusion = DependentConclusion & { latestAddendum: number; reasonZh: string };

/** 影响该行的最新补遗号；没有则为 0。 */
export function latestAddendumFor(lineNo: number, addenda: readonly Addendum[]): number {
  return addenda.filter((a) => a.affectedLineNos.includes(lineNo)).reduce((max, a) => Math.max(max, a.number), 0);
}

export function findStaleConclusions(
  addenda: readonly Addendum[],
  conclusions: readonly DependentConclusion[],
): { stale: StaleConclusion[]; reviewListZh: string[] } {
  const stale: StaleConclusion[] = [];
  for (const c of conclusions) {
    const latest = latestAddendumFor(c.lineNo, addenda);
    if (latest > c.basedOnAddendum) {
      const basis = c.basedOnAddendum === 0 ? "原始文件" : `第 ${c.basedOnAddendum} 号补遗`;
      stale.push({ ...c, latestAddendum: latest, reasonZh: `第 ${c.lineNo} 行的${DEPENDENT_KIND_ZH[c.kind]}基于${basis}，第 ${latest} 号补遗之后需要复核` });
    }
  }
  return { stale, reviewListZh: stale.map((s) => s.reasonZh) };
}
