/**
 * 情报调研树的规则表（纯函数，不连库、不调模型）：
 * - 每一支的定义（类别、波次、目标句、允许的事实类型、额度缩放）；
 * - 分叉规则（任务书 TREE-2）：② 没查到 → 第二波甲「同类项目全量」；② 查到中标方 → 待反查（本批只列出）；
 *   ③（含第二波甲）收下的同类授标不足 3 条 → 第二波乙「同类项目放宽」；子代理建议、不在规则表的 → 未追的线索；
 * - 一支收尾时的状态与未查到原因（优先级：到上限 > 被挡 > 未接通 > 没有）与中文句。
 */

import type {
  BranchKind,
  BranchStatus,
  FoundFact,
  NotFoundEntry,
  NotFoundReason,
  ResearchHandoffV1,
  SuggestedBranch,
} from "./types";
import { RESEARCH_HANDOFF_VERSION } from "./types";
import { RESEARCH_TREE_LIMITS } from "./limits";

/** 计划里的步骤 id（= 运行时的 stepKey = 分支键） */
export const RESEARCH_STEP_IDS = Object.freeze({
  clauses: "research_clauses",
  priorAwards: "research_prior_awards",
  similar: "research_similar",
  wave2Full: "research_wave2_full",
  wave2Relaxed: "research_wave2_relaxed",
  trunk: "research_trunk",
});

export type ResearchBranchStepId =
  | typeof RESEARCH_STEP_IDS.clauses
  | typeof RESEARCH_STEP_IDS.priorAwards
  | typeof RESEARCH_STEP_IDS.similar
  | typeof RESEARCH_STEP_IDS.wave2Full
  | typeof RESEARCH_STEP_IDS.wave2Relaxed;

export type BranchDef = {
  stepId: ResearchBranchStepId;
  kind: BranchKind;
  wave: 1 | 2;
  /** 在树里的深度（主干为 0） */
  depth: number;
  labelZh: string;
  /** 交给模型的目标句（TREE-3 替换成三个子代理各自的做法） */
  goalZh: string;
  /** 这一支允许收下的事实类型 */
  factTypes: readonly string[];
  /** 额度缩放：第一波 ③ 限量用一半 */
  scale: "full" | "half";
  /** 这一支本批不联网、不调模型（条款员在 TREE-3 接入） */
  notWired: boolean;
};

const PRIOR_FACTS = ["prior_tender", "winner", "award_amount", "quantity", "award_year"] as const;
const SIMILAR_FACTS = ["comparable_award", "buyer", "award_amount", "quantity", "award_year"] as const;

export const BRANCH_DEFS: Readonly<Record<ResearchBranchStepId, BranchDef>> = Object.freeze({
  [RESEARCH_STEP_IDS.clauses]: {
    stepId: RESEARCH_STEP_IDS.clauses,
    kind: "clauses",
    wave: 1,
    depth: 1,
    labelZh: "条款",
    goalZh: "确认标书是否要求本地 / 加拿大含量、是否指定品牌、是否接受等效品。",
    factTypes: [],
    scale: "full",
    notWired: true,
  },
  [RESEARCH_STEP_IDS.priorAwards]: {
    stepId: RESEARCH_STEP_IDS.priorAwards,
    kind: "prior_awards",
    wave: 1,
    depth: 1,
    labelZh: "往期同标",
    goalZh: "找同一个采购方近几年是否发过同样的采购；有的话，谁中标、合同额、数量、年份。",
    factTypes: PRIOR_FACTS,
    scale: "full",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.similar]: {
    stepId: RESEARCH_STEP_IDS.similar,
    kind: "similar",
    wave: 1,
    depth: 1,
    labelZh: "同类项目（限量）",
    goalZh: "找加拿大近 3 年数量与要求相近（一半到两倍）的同类采购的授标：采购方、年份、数量、合同额。",
    factTypes: SIMILAR_FACTS,
    scale: "half",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.wave2Full]: {
    stepId: RESEARCH_STEP_IDS.wave2Full,
    kind: "similar_full",
    wave: 2,
    depth: 2,
    labelZh: "同类项目（全量）",
    goalZh: "往期同标没查到：继续找加拿大近 3 年数量与要求相近的同类采购的授标，避开已经查过的来源。",
    factTypes: SIMILAR_FACTS,
    scale: "full",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.wave2Relaxed]: {
    stepId: RESEARCH_STEP_IDS.wave2Relaxed,
    kind: "similar_relaxed",
    wave: 2,
    depth: 2,
    labelZh: "同类项目（放宽）",
    goalZh: "同类授标不足 3 条：放宽到数量不限、近 6 年、加上美国，找同类型采购的授标（币种照原文）。",
    factTypes: SIMILAR_FACTS,
    scale: "full",
    notWired: false,
  },
});

export const BRANCH_STEP_IDS: readonly ResearchBranchStepId[] = Object.freeze([
  RESEARCH_STEP_IDS.clauses,
  RESEARCH_STEP_IDS.priorAwards,
  RESEARCH_STEP_IDS.similar,
  RESEARCH_STEP_IDS.wave2Full,
  RESEARCH_STEP_IDS.wave2Relaxed,
]);

export function branchDefOf(stepKey: string): BranchDef | null {
  return (BRANCH_DEFS as Record<string, BranchDef>)[stepKey] ?? null;
}

/* ───────────────────────────── 中文句 ───────────────────────────── */

export const TEXT_ZH = Object.freeze({
  limit: "到上限，未查完",
  blockedNothing: "这一支被挡，未查到",
  none: "没有查到",
  flagOff: "未接通：情报调研树的开关已关",
  clausesNotWired: "未接通：条款员尚未接入（TREE-3），本批不查",
  searchUnavailable: "未接通：搜索服务没有开通",
  modelUnavailable: "未接通：模型暂时不可用",
  internalError: "未接通：这一支内部出错，已停下",
  wave2FullNotNeeded: "无需追查：往期同标已查到",
  wave2RelaxedNotNeeded: "无需追查：同类授标已有 3 条以上",
});

export const STATUS_ZH: Readonly<Record<BranchStatus, string>> = Object.freeze({
  found: "查到",
  none: "没查到",
  blocked: "被挡",
  limit: "到上限",
  unavailable: "未接通",
  not_needed: "无需追查",
  flag_off: "开关已关",
});

export function statusLineZh(status: BranchStatus, foundCount: number): string {
  if (status === "found") return `查到 ${foundCount} 条`;
  return STATUS_ZH[status];
}

/* ───────────────────────────── 收尾 ───────────────────────────── */

export type BranchEndFacts = {
  foundCount: number;
  /** 额度用完而模型没说结束（模型请求到上限、或搜索与读页都已到上限） */
  exhausted: boolean;
  /** 读过被挡的页（被挡站数 > 0） */
  anyBlocked: boolean;
  /** 不可用的原因（搜索未接通、模型不可用、内部出错）；null 表示都接通了 */
  unavailableZh: string | null;
};

/** 一支收尾：状态与未查到原因（优先级：到上限 > 被挡 > 未接通 > 没有）。查到了的也记「到上限，未查完」 */
export function branchOutcome(f: BranchEndFacts): { status: BranchStatus; notFound: NotFoundEntry[] } {
  const notFound: NotFoundEntry[] = [];
  if (f.foundCount > 0) {
    if (f.exhausted) notFound.push({ reason: "limit", messageZh: TEXT_ZH.limit });
    return { status: "found", notFound };
  }
  if (f.exhausted) return { status: "limit", notFound: [{ reason: "limit", messageZh: TEXT_ZH.limit }] };
  if (f.anyBlocked) return { status: "blocked", notFound: [{ reason: "blocked", messageZh: TEXT_ZH.blockedNothing }] };
  if (f.unavailableZh) return { status: "unavailable", notFound: [{ reason: "unavailable", messageZh: f.unavailableZh }] };
  return { status: "none", notFound: [{ reason: "none", messageZh: TEXT_ZH.none }] };
}

/** 不需要联网就能交的单（开关已关、条款未接入、第二波无需追查） */
export function staticHandoff(
  def: BranchDef,
  status: "flag_off" | "unavailable" | "not_needed",
  messageZh: string,
): ResearchHandoffV1 {
  const reason: NotFoundReason | null = status === "not_needed" ? null : "unavailable";
  return {
    version: RESEARCH_HANDOFF_VERSION,
    branchKey: def.stepId,
    kind: def.kind,
    status,
    statusZh: status === "not_needed" ? messageZh : statusLineZh(status, 0),
    found: [],
    notFound: reason ? [{ reason, messageZh }] : [],
    suggestedBranches: [],
    usage: { searches: 0, reads: 0, modelCalls: 0, blockedSites: 0, elapsedMs: 0 },
    blockedSites: [],
    rejectedFacts: 0,
  };
}

/* ───────────────────────────── 分叉 ───────────────────────────── */

/** 从上游 outputJson 取交接单（形状不对的当作没有） */
export function handoffFromOutput(output: unknown): ResearchHandoffV1 | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const h = (output as Record<string, unknown>).researchHandoff;
  if (!h || typeof h !== "object" || Array.isArray(h)) return null;
  const r = h as Record<string, unknown>;
  if (r.version !== RESEARCH_HANDOFF_VERSION || !Array.isArray(r.found) || !Array.isArray(r.notFound)) return null;
  return h as ResearchHandoffV1;
}

/** ② 往期同标「没查到」= 一条事实都没收下（含未接通、被挡、到上限） */
export function priorAwardsFoundNothing(prior: ResearchHandoffV1 | null): boolean {
  return !prior || prior.found.length === 0;
}

/** 收下的同类授标条数（按网址 + 值去重） */
export function comparableAwardCount(handoffs: ReadonlyArray<ResearchHandoffV1 | null>): number {
  const seen = new Set<string>();
  for (const h of handoffs) {
    for (const f of h?.found ?? []) {
      if (f.factType === "comparable_award") seen.add(`${f.url}\u0000${f.value}`);
    }
  }
  return seen.size;
}

export const MIN_COMPARABLE_AWARDS = 3;

export type Wave2Decision = { run: boolean; reasonZh: string };

/** 第二波甲：② 没查到 → 同类项目全量 */
export function decideWave2Full(prior: ResearchHandoffV1 | null): Wave2Decision {
  return priorAwardsFoundNothing(prior)
    ? { run: true, reasonZh: "往期同标没查到，转查同类项目（全量）" }
    : { run: false, reasonZh: TEXT_ZH.wave2FullNotNeeded };
}

/** 第二波乙：③（含第二波甲）收下的同类授标不足 3 条 → 放宽 */
export function decideWave2Relaxed(similar: ReadonlyArray<ResearchHandoffV1 | null>): Wave2Decision {
  const n = comparableAwardCount(similar);
  return n < MIN_COMPARABLE_AWARDS
    ? { run: true, reasonZh: `同类授标只有 ${n} 条，放宽到数量不限、近 6 年、加上美国` }
    : { run: false, reasonZh: TEXT_ZH.wave2RelaxedNotNeeded };
}

/** 摘要里不放金额与网址：看着像金额（货币符号、连着 3 位以上的数字）的名字不收 */
export function looksLikeAmountOrUrl(s: string): boolean {
  return /[$€£¥]|\d[\d,.\s]{1,}\d{1,}|\d{3,}|https?:\/\/|www\./i.test(s);
}

/** 摘要里的自由文字：去掉网址，把成串的数字换成「…」 */
export function scrubSummaryText(s: string, max: number): string {
  return s
    .replace(/https?:\/\/\S+|www\.\S+/gi, "（网址略）")
    .replace(/[$€£¥]\s*/g, "")
    .replace(/\d[\d,.\s]*\d|\d/g, (m) => (m.replace(/\D/g, "").length >= 3 ? "…" : m))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** 待反查：② 收下的中标方名（去重、保留先后，最多 10 个；看着像金额或网址的不收） */
export function pendingReverseOf(prior: ResearchHandoffV1 | null): string[] {
  const out: string[] = [];
  for (const f of prior?.found ?? []) {
    if (f.factType !== "winner") continue;
    const name = f.value.trim().slice(0, 120);
    if (looksLikeAmountOrUrl(name)) continue;
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= RESEARCH_TREE_LIMITS.MAX_PENDING_REVERSE) break;
  }
  return out;
}

/** 规则表里能自动长出来的分支类别（本批第二波的两类由上面两条规则决定，模型建议不触发任何自动生长） */
export const RULE_TABLE_KINDS: ReadonlySet<string> = new Set(["similar_full", "similar_relaxed"]);

/** 未追的线索：各支建议的分支，去重（最多 20 条；文字去掉网址与成串数字）。规则表里的两类已由规则处理，不重复列 */
export function unchasedLeadsOf(handoffs: ReadonlyArray<ResearchHandoffV1 | null>): SuggestedBranch[] {
  const out: SuggestedBranch[] = [];
  const seen = new Set<string>();
  for (const h of handoffs) {
    for (const raw of h?.suggestedBranches ?? []) {
      if (typeof raw?.kind !== "string" || typeof raw?.reasonZh !== "string") continue;
      const s = { kind: scrubSummaryText(raw.kind, 40), reasonZh: scrubSummaryText(raw.reasonZh, 200) };
      if (!s.kind || !s.reasonZh || RULE_TABLE_KINDS.has(s.kind)) continue;
      const key = `${s.kind}\u0000${s.reasonZh}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= RESEARCH_TREE_LIMITS.MAX_UNCHASED_LEADS) return out;
    }
  }
  return out;
}

/** 同一支内同网址同类型同值的事实去重 */
export function dedupeFacts(facts: readonly FoundFact[]): FoundFact[] {
  const seen = new Set<string>();
  const out: FoundFact[] = [];
  for (const f of facts) {
    const k = `${f.url}\u0000${f.factType}\u0000${f.value.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
