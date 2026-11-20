/**
 * CHAIN-3 进口商 ↔ 历史中标者比对（纯函数，照 TI-3a 三档）
 *
 * 同名或人工已确认是同一家 → 挂上；只差公司后缀 / 一方整词包含另一方、且这一对没裁决过 → 疑似同一家，等人确认；
 * 其余（含被否决的）→ 无关。一条记录既与一个中标者同名、又与另一个是建议时，以同名为准，不再列建议。
 * 裁决只追加、按对查最新的一条（见 service），这里只吃裁决结果，挂上与否每次读的时候重新算。
 *
 * 性能：TI-3a 的 compareCompanyNames / aliasPairKey 每比一对都要把两个名称从头规整一遍；这里每个名称只规整一次
 * （中标者在建比对器时、进口商按规整后名称记住），规则与 TI-3a 逐字相同（测试里与 compareCompanyNames 对照）。
 */

import {
  SUGGESTION_BASIS_ZH,
  normalizeCompanyName,
  stripLegalSuffix,
  type AliasDecision,
  type NameRelation,
  type SuggestionBasis,
} from "@/lib/tender-competition/company-identity";

export type ImporterSuggestion = { winnerName: string; pairKey: string; basis: SuggestionBasis; basisZh: string };
export type ImporterMatch =
  | { status: "MATCHED"; winners: string[] }
  | { status: "SUGGESTED"; suggestions: ImporterSuggestion[] }
  | { status: "UNRELATED" };

/** 与 TI-3a company-identity 的 MIN_CONTAIN_TOKENS 相同 */
const MIN_CONTAIN_TOKENS = 2;

export type PreparedName = { raw: string; norm: string; stripped: string; tokens: string[] };

export function prepareName(raw: string): PreparedName {
  const norm = normalizeCompanyName(raw);
  const stripped = norm ? stripLegalSuffix(norm) : "";
  return { raw, norm, stripped, tokens: stripped.split(" ") };
}

/** 与 compareCompanyNames 同一规则，只是吃已规整的名称 */
export function relatePrepared(a: PreparedName, b: PreparedName): NameRelation {
  if (!a.norm || !b.norm) return { relation: "UNRELATED" };
  if (a.norm === b.norm) return { relation: "SAME_NAME" };
  if (a.stripped === b.stripped) return { relation: "SUGGEST_SAME_ENTITY", basis: "LEGAL_SUFFIX_ONLY", basisZh: SUGGESTION_BASIS_ZH.LEGAL_SUFFIX_ONLY };
  const [short, long] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  if (short.length >= MIN_CONTAIN_TOKENS && short.length < long.length && short.every((t, i) => long[i] === t)) {
    return { relation: "SUGGEST_SAME_ENTITY", basis: "NAME_CONTAINS", basisZh: SUGGESTION_BASIS_ZH.NAME_CONTAINS };
  }
  return { relation: "UNRELATED" };
}

/** 与 aliasPairKey 相同：两个规整后名称排序后用「 ⇄ 」连起来 */
export function preparedPairKey(a: PreparedName, b: PreparedName): string {
  return [a.norm, b.norm].sort().join(" ⇄ ");
}

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

/** 建一个比对器：中标者只规整一次，同一个进口商（规整后）只比一次 */
export function createImporterMatcher(winners: readonly string[], decisions: readonly AliasDecision[]): (importer: string) => ImporterMatch {
  const prepared = winners.map(prepareName);
  const byPair = new Map(decisions.map((d) => [d.pairKey, d.decision]));
  const memo = new Map<string, ImporterMatch>();
  return (importer: string) => {
    const imp = prepareName(importer);
    const hit = memo.get(imp.norm);
    if (hit) return hit;
    const matched: string[] = [];
    const suggestions: ImporterSuggestion[] = [];
    for (const w of prepared) {
      const rel = relatePrepared(imp, w);
      if (rel.relation === "SAME_NAME") {
        matched.push(w.raw);
        continue;
      }
      if (rel.relation !== "SUGGEST_SAME_ENTITY") continue;
      const pairKey = preparedPairKey(imp, w);
      const decided = byPair.get(pairKey);
      if (decided === "CONFIRMED") matched.push(w.raw);
      else if (!decided) suggestions.push({ winnerName: w.raw, pairKey, basis: rel.basis, basisZh: rel.basisZh });
    }
    const out: ImporterMatch = matched.length ? { status: "MATCHED", winners: matched } : suggestions.length ? { status: "SUGGESTED", suggestions } : { status: "UNRELATED" };
    memo.set(imp.norm, out);
    return out;
  };
}

export function matchImporter(importer: string, winners: readonly string[], decisions: readonly AliasDecision[]): ImporterMatch {
  return createImporterMatcher(winners, decisions)(importer);
}

/** 本项目所有记录可能用到的「进口商 ⇄ 中标者」候选对（用来按对查裁决）；进口商按规整后名称只比一次 */
export type CandidatePair = { pairKey: string; winnerName: string };

/**
 * CHAIN-3c：一个进口商（原文）与中标者之间所有「疑似同一家」的一对（不看裁决）；同一个规整名只算一次。
 * 「已裁决的」一节与撤回接口据此判断一对是不是本项目现有记录涉及的。
 */
export function createCandidatePairFinder(winners: readonly string[]): (importer: string) => CandidatePair[] {
  const prepared = winners.map(prepareName);
  const memo = new Map<string, CandidatePair[]>();
  return (importer: string) => {
    const imp = prepareName(importer);
    if (!imp.norm) return [];
    const hit = memo.get(imp.norm);
    if (hit) return hit;
    const out: CandidatePair[] = [];
    for (const w of prepared) if (relatePrepared(imp, w).relation === "SUGGEST_SAME_ENTITY") out.push({ pairKey: preparedPairKey(imp, w), winnerName: w.raw });
    memo.set(imp.norm, out);
    return out;
  };
}

export function candidatePairKeys(importers: readonly string[], winners: readonly string[]): string[] {
  const prepared = winners.map(prepareName);
  const seenImporters = new Set<string>();
  const out = new Set<string>();
  for (const raw of importers) {
    const imp = prepareName(raw);
    if (!imp.norm || seenImporters.has(imp.norm)) continue;
    seenImporters.add(imp.norm);
    for (const w of prepared) if (relatePrepared(imp, w).relation === "SUGGEST_SAME_ENTITY") out.add(preparedPairKey(imp, w));
  }
  return [...out];
}
