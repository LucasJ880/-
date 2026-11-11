/**
 * TI-3a 公司名称比对（纯函数，确定性）
 *
 * 三档：同名 / 建议（疑似同一实体，待人工确认）/ 无关。
 * - 同名 = 既有规范化（corporate-memory/normalize，授标记录用的同一规则）后完全相等。
 * - 建议只有两条确定性依据：只差公司后缀；一方按整词完整包含另一方。
 * - 不做编辑距离或相似度打分（Pest 与 Pet 只差一个字母，却是两家公司）；系统不自动合并。
 */
import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";

export const LEGAL_SUFFIX_TOKENS: readonly string[] = [
  "inc", "incorporated", "ltd", "limited", "corp", "corporation", "co", "company", "llc", "ulc", "lp", "llp", "ltee", "ltée", "plc",
];

export function normalizeCompanyName(name: string): string {
  return normalizeBuyerName(name);
}

/** 去掉名称末尾的公司后缀词（可连续多个，如 "co ltd"）。 */
export function stripLegalSuffix(normalized: string): string {
  const tokens = normalized.split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIX_TOKENS.includes(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export const SUGGESTION_BASES = ["LEGAL_SUFFIX_ONLY", "NAME_CONTAINS"] as const;
export type SuggestionBasis = (typeof SUGGESTION_BASES)[number];
export const SUGGESTION_BASIS_ZH: Record<SuggestionBasis, string> = {
  LEGAL_SUFFIX_ONLY: "只差公司后缀",
  NAME_CONTAINS: "一方名称完整包含另一方",
};

export type NameRelation =
  | { relation: "SAME_NAME" }
  | { relation: "SUGGEST_SAME_ENTITY"; basis: SuggestionBasis; basisZh: string }
  | { relation: "UNRELATED" };

const MIN_CONTAIN_TOKENS = 2;

export function compareCompanyNames(a: string, b: string): NameRelation {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return { relation: "UNRELATED" };
  if (na === nb) return { relation: "SAME_NAME" };
  const ca = stripLegalSuffix(na);
  const cb = stripLegalSuffix(nb);
  if (ca === cb) return { relation: "SUGGEST_SAME_ENTITY", basis: "LEGAL_SUFFIX_ONLY", basisZh: SUGGESTION_BASIS_ZH.LEGAL_SUFFIX_ONLY };
  const ta = ca.split(" ");
  const tb = cb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= MIN_CONTAIN_TOKENS && short.length < long.length && short.every((t, i) => long[i] === t)) {
    return { relation: "SUGGEST_SAME_ENTITY", basis: "NAME_CONTAINS", basisZh: SUGGESTION_BASIS_ZH.NAME_CONTAINS };
  }
  return { relation: "UNRELATED" };
}

/** 人工对一条建议的裁决。确认与否决都留痕；否决过的一对不再建议。 */
export type AliasDecision = {
  pairKey: string;
  nameA: string;
  nameB: string;
  decision: "CONFIRMED" | "REJECTED";
  decidedBy: string;
  decidedAt: string;
};

export type AliasSuggestion = {
  pairKey: string;
  nameA: string;
  nameB: string;
  basis: SuggestionBasis;
  basisZh: string;
  status: "PENDING_REVIEW";
};

export function aliasPairKey(a: string, b: string): string {
  return [normalizeCompanyName(a), normalizeCompanyName(b)].sort().join(" ⇄ ");
}

/** 在一组名称里找出待人工确认的「疑似同一实体」；已裁决（确认或否决）的不再出现。 */
export function suggestAliases(names: readonly string[], decisions: readonly AliasDecision[] = []): AliasSuggestion[] {
  const decided = new Set(decisions.map((d) => d.pairKey));
  const seen = new Set<string>();
  const out: AliasSuggestion[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const rel = compareCompanyNames(names[i], names[j]);
      if (rel.relation !== "SUGGEST_SAME_ENTITY") continue;
      const pairKey = aliasPairKey(names[i], names[j]);
      if (decided.has(pairKey) || seen.has(pairKey)) continue;
      seen.add(pairKey);
      out.push({ pairKey, nameA: names[i], nameB: names[j], basis: rel.basis, basisZh: rel.basisZh, status: "PENDING_REVIEW" });
    }
  }
  return out;
}

export function decideAlias(
  suggestion: Pick<AliasSuggestion, "pairKey" | "nameA" | "nameB">,
  input: { decision: "CONFIRMED" | "REJECTED"; decidedBy: string; decidedAt: string },
): { ok: true; decision: AliasDecision } | { ok: false; code: "DECIDER_MISSING" | "DECIDED_AT_MISSING"; messageZh: string } {
  if (!input.decidedBy?.trim()) return { ok: false, code: "DECIDER_MISSING", messageZh: "缺少确认人" };
  if (!input.decidedAt?.trim()) return { ok: false, code: "DECIDED_AT_MISSING", messageZh: "缺少确认时间" };
  return { ok: true, decision: { pairKey: suggestion.pairKey, nameA: suggestion.nameA, nameB: suggestion.nameB, decision: input.decision, decidedBy: input.decidedBy.trim(), decidedAt: input.decidedAt.trim() } };
}

/** 同一实体的判定：同名，或人工已确认的别名。建议中的、被否决的都不算。 */
export function isSameEntity(a: string, b: string, decisions: readonly AliasDecision[] = []): boolean {
  if (compareCompanyNames(a, b).relation === "SAME_NAME") return true;
  const key = aliasPairKey(a, b);
  return decisions.some((d) => d.pairKey === key && d.decision === "CONFIRMED");
}
