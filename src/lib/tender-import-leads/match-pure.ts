/**
 * CHAIN-3 进口商 ↔ 历史中标者比对（纯函数，照 TI-3a 三档）
 *
 * 同名或人工已确认是同一家 → 挂上；只差公司后缀 / 一方整词包含另一方、且这一对没裁决过 → 疑似同一家，等人确认；
 * 其余（含被否决的）→ 无关。一条记录既与一个中标者同名、又与另一个是建议时，以同名为准，不再列建议。
 * 裁决只追加、按对查最新的一条（见 service），这里只吃裁决结果，挂上与否每次读的时候重新算。
 */

import { aliasPairKey, compareCompanyNames, isSameEntity, normalizeCompanyName, type AliasDecision, type SuggestionBasis } from "@/lib/tender-competition/company-identity";

export type ImporterSuggestion = { winnerName: string; pairKey: string; basis: SuggestionBasis; basisZh: string };
export type ImporterMatch =
  | { status: "MATCHED"; winners: string[] }
  | { status: "SUGGESTED"; suggestions: ImporterSuggestion[] }
  | { status: "UNRELATED" };

/** 中标者名称按规整后去重（保留第一次出现的写法） */
export function uniqueWinnerNames(names: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const raw = n?.trim();
    if (!raw) continue;
    const key = normalizeCompanyName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function matchImporter(importer: string, winners: readonly string[], decisions: readonly AliasDecision[]): ImporterMatch {
  const matched = winners.filter((w) => isSameEntity(importer, w, decisions));
  if (matched.length) return { status: "MATCHED", winners: matched };
  const decided = new Set(decisions.map((d) => d.pairKey));
  const suggestions: ImporterSuggestion[] = [];
  for (const w of winners) {
    const rel = compareCompanyNames(importer, w);
    if (rel.relation !== "SUGGEST_SAME_ENTITY") continue;
    const pairKey = aliasPairKey(importer, w);
    if (decided.has(pairKey)) continue;
    suggestions.push({ winnerName: w, pairKey, basis: rel.basis, basisZh: rel.basisZh });
  }
  return suggestions.length ? { status: "SUGGESTED", suggestions } : { status: "UNRELATED" };
}

/** 本项目所有记录可能用到的「进口商 ⇄ 中标者」候选对（用来按对查裁决） */
export function candidatePairKeys(importers: readonly string[], winners: readonly string[]): string[] {
  const out = new Set<string>();
  for (const imp of importers) {
    for (const w of winners) {
      if (compareCompanyNames(imp, w).relation === "SUGGEST_SAME_ENTITY") out.add(aliasPairKey(imp, w));
    }
  }
  return [...out];
}
