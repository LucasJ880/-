/**
 * 情报调研树的规则表（纯函数，不连库、不调模型）：
 * - 每一支的定义（类别、波次、目标句、允许的事实类型、额度缩放）；
 * - 分叉规则（任务书 TREE-2；TREE-3 改按授标记录）：② 一条记录都没有 → 第二波甲「同类项目补查」；② 的记录有中标方
 *   → 待反查（本批只列出）；③（含第二波甲）能算出单价的同类记录不足 3 条 → 第二波乙「同类项目放宽」；子代理建议、
 *   不在规则表的 → 未追的线索；
 * - 一支收尾时的状态与未查到原因（一条没查到时成立的原因都列出，状态取：被挡 > 到上限 > 未接通 > 没查到）与中文句。
 */

import type {
  BranchKind,
  BranchStatus,
  FoundFact,
  NotFoundEntry,
  ResearchAwardRecordV1,
  ResearchHandoffV1,
} from "./types";
import { RESEARCH_HANDOFF_VERSION } from "./types";
import { RESEARCH_TREE_LIMITS } from "./limits";
import { statedCount } from "./clauses";

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
  /** 交给模型的目标句 */
  goalZh: string;
  /** 这一支允许收下的事实类型 */
  factTypes: readonly string[];
  /** 额度缩放：第一波 ③（初查）用一半 */
  scale: "full" | "half";
  /** 这一支不联网、不调模型（TREE-3 起没有这样的支；留着给以后暂不接通的支用） */
  notWired: boolean;
};

const PRIOR_FACTS = ["prior_tender", "winner", "buyer", "item", "award_amount", "quantity", "award_year", "currency", "scope_basis"] as const;
const SIMILAR_FACTS = ["winner", "buyer", "item", "award_amount", "quantity", "award_year", "currency", "scope_basis"] as const;
/** 值里必须有数字的事实类型（金额、数量、年份） */
export const NUMERIC_FACT_TYPES: readonly string[] = Object.freeze(["award_amount", "quantity", "award_year"]);
/** 值是枚举的事实类型（币种 CAD / USD；口径四个标签），核对见 guards.checkFact */
export const ENUM_FACT_TYPES: readonly string[] = Object.freeze(["currency", "scope_basis"]);

/** 授标支（交记录的支） */
export function isAwardKind(kind: BranchKind): boolean {
  return kind !== "clauses";
}

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
    notWired: false,
  },
  [RESEARCH_STEP_IDS.priorAwards]: {
    stepId: RESEARCH_STEP_IDS.priorAwards,
    kind: "prior_awards",
    wave: 1,
    depth: 1,
    labelZh: "往期同标",
    goalZh:
      "找同一个采购方上一期（近几年）是否发过同样的采购；有的话，谁中标、合同额、数量、年份、币种与口径（含安装 / 含运费 / 多年期 / 多品项）。联邦合同公开数据已经由系统先查过，见本轮结果；可以接着搜它们的授标公告补数量。",
    factTypes: PRIOR_FACTS,
    scale: "full",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.similar]: {
    stepId: RESEARCH_STEP_IDS.similar,
    kind: "similar",
    wave: 1,
    depth: 1,
    labelZh: "同类项目（初查）",
    goalZh:
      "找加拿大近 3 年数量与要求相近（一半到两倍）的同类采购的授标：每一笔的采购方、年份、数量、合同额、币种与口径（含安装 / 含运费 / 多年期 / 多品项）。",
    factTypes: SIMILAR_FACTS,
    scale: "half",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.wave2Full]: {
    stepId: RESEARCH_STEP_IDS.wave2Full,
    kind: "similar_full",
    wave: 2,
    depth: 2,
    labelZh: "同类项目（补查）",
    goalZh:
      "往期同标没查到成条的授标：继续找加拿大近 3 年数量与要求相近的同类采购的授标（采购方、年份、数量、合同额、币种、口径），避开已经查过的来源。",
    factTypes: SIMILAR_FACTS,
    scale: "full",
    notWired: false,
  },
  [RESEARCH_STEP_IDS.wave2Relaxed]: {
    stepId: RESEARCH_STEP_IDS.wave2Relaxed,
    kind: "similar_relaxed",
    wave: 2,
    depth: 2,
    labelZh: "同类项目（放宽条件）",
    goalZh:
      "能算出单价的同类授标不足 3 条：放宽到数量不限、近 6 年、加上美国，找同类型采购的授标（采购方、年份、数量、合同额、币种照原文、口径）。",
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
  none: "没查到",
  flagOff: "未开启：情报调研树没有对本组织开放",
  notWired: "未接通：这一支还没有接入",
  clausesNoDocs: "未接通：项目里还没有解析好的标书文件，没法查条款",
  clausesScannedOnly: "未接通：标书都是扫描件，没有文字可查",
  clausesModelUsed: "未接通：条款员这次的模型请求没有拿到结果",
  clausesModelFailed: "未接通：条款员没有交回可用的结论（模型不可用或回答格式不对），这次没有结论",
  clausesNoneStated: "都未写明",
  noneScattered: "没查到成条的授标：只收下了零散的事实，凑不成一条授标",
  openDataOff: "联邦合同公开数据没有开通，只用了搜索与读页",
  openDataNoQuery: "项目名里没有可用的英文检索词，没有查联邦合同公开数据",
  openDataBlocked: "联邦合同公开数据的检索词被外发闸拦下，没有查",
  searchUnavailable: "未接通：搜索服务没有开通",
  searchFailed: "未接通：搜索服务出错，这一支没查成",
  modelUnavailable: "未接通：模型暂时不可用",
  internalError: "出错停下了：这一支没查完，可以重新查",
  projectMissing: "没查：项目已删除或不再是招投标项目",
});

export const STATUS_ZH: Readonly<Record<BranchStatus, string>> = Object.freeze({
  found: "查到",
  none: "没查到",
  blocked: "被挡",
  limit: "到上限",
  unavailable: "未接通",
  not_needed: "无需追查",
  flag_off: "未开启",
});

/**
 * 状态短标签（交接单与树干摘要的 statusZh 一律用它；整句只放在 notFound[].messageZh 与 reasonZh）。
 * 授标支的 N 是记录数；条款支「写明了 N 项」/「都未写明」
 */
export function statusLineZh(status: BranchStatus, foundCount: number, kind?: BranchKind): string {
  if (kind === "clauses") {
    if (status === "found") return `写明了 ${foundCount} 项`;
    if (status === "none") return TEXT_ZH.clausesNoneStated;
  }
  if (status === "found") return `查到 ${foundCount} 条`;
  return STATUS_ZH[status];
}

/* ───────────────────────────── 收尾 ───────────────────────────── */

export type BranchEndFacts = {
  foundCount: number;
  /**
   * 这一支因为额度停下：模型请求到上限、搜索与读页都不能再用而额度已用完、模型要的搜索或读页因额度被拒、
   * 这棵树的游标超限。模型自己说结束（哪怕某项额度恰好用满）不算
   */
  limitHit: boolean;
  /** 读过被挡的页（被挡站数 > 0） */
  anyBlocked: boolean;
  /** 不可用的原因（搜索没开通、模型不可用、内部出错）；null 表示都接通了 */
  unavailableZh: string | null;
  /** 发出过的搜索里出错的次数（超时、限流、服务出错、鉴权失败）与成功的次数（含没有结果） */
  searchFailures: number;
  searchSuccesses: number;
  /** 这一支是出错停下的（审计写不进去、内部出错）：「未接通 / 出错停下了」排在最前 */
  stopped?: boolean;
};

/**
 * 一支收尾：状态与未查到原因。查到了：状态「查到」，额度停下的另记「到上限，未查完」。一条都没查到：把成立的原因
 * 都列出来（被挡、到上限、未接通；都不成立才是「没查到」），状态取第一条（被挡 > 到上限 > 未接通 > 没查到）。
 * 搜索一次都没成功、全部出错的算「未接通：搜索服务出错」，不说成「没查到」。
 */
export function branchOutcome(f: BranchEndFacts): { status: BranchStatus; notFound: NotFoundEntry[] } {
  if (f.foundCount > 0) {
    const nf: NotFoundEntry[] = [];
    if (f.stopped && f.unavailableZh) nf.push({ reason: "unavailable", messageZh: f.unavailableZh });
    if (f.limitHit) nf.push({ reason: "limit", messageZh: TEXT_ZH.limit });
    return { status: "found", notFound: nf };
  }
  const notFound: NotFoundEntry[] = [];
  if (f.stopped && f.unavailableZh) notFound.push({ reason: "unavailable", messageZh: f.unavailableZh });
  if (f.anyBlocked) notFound.push({ reason: "blocked", messageZh: TEXT_ZH.blockedNothing });
  if (f.limitHit) notFound.push({ reason: "limit", messageZh: TEXT_ZH.limit });
  if (f.unavailableZh && !f.stopped) notFound.push({ reason: "unavailable", messageZh: f.unavailableZh });
  else if (!f.unavailableZh && f.searchSuccesses === 0 && f.searchFailures > 0) notFound.push({ reason: "unavailable", messageZh: TEXT_ZH.searchFailed });
  if (notFound.length === 0) notFound.push({ reason: "none", messageZh: TEXT_ZH.none });
  const first = notFound[0]!.reason;
  const status: BranchStatus = first === "blocked" ? "blocked" : first === "limit" ? "limit" : first === "unavailable" ? "unavailable" : "none";
  return { status, notFound };
}

/** 不需要联网就能交的单（未开启、条款未接入、第二波无需追查、出错停下） */
export function staticHandoff(
  def: BranchDef,
  status: "flag_off" | "unavailable" | "not_needed",
  messageZh: string,
): ResearchHandoffV1 {
  const notNeeded = status === "not_needed";
  return {
    version: RESEARCH_HANDOFF_VERSION,
    branchKey: def.stepId,
    kind: def.kind,
    labelZh: def.labelZh,
    status,
    statusZh: statusLineZh(status, 0, def.kind),
    reasonZh: notNeeded ? messageZh : null,
    found: [],
    records: [],
    clauses: null,
    notFound: notNeeded ? [] : [{ reason: "unavailable", messageZh }],
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

/** 交接单里的授标记录（TREE-2 交的旧单没有这一项 → 空） */
export function recordsOf(h: ResearchHandoffV1 | null | undefined): ResearchAwardRecordV1[] {
  return h && Array.isArray(h.records) ? h.records : [];
}

/** 交接单的「查到 N 条 / 写明了 N 项」里的 N：授标支是记录数，条款支是写明的问数 */
export function foundCountOf(h: ResearchHandoffV1 | null | undefined): number {
  if (!h) return 0;
  if (h.kind === "clauses") return statedCount(h.clauses ?? null);
  return recordsOf(h).length;
}

/** ② 往期同标「没查到」= 一条授标记录都没有（含未接通、被挡、到上限、只有零散事实） */
export function priorAwardsFoundNothing(prior: ResearchHandoffV1 | null): boolean {
  return recordsOf(prior).length === 0;
}

/** 能算出单价的同类记录条数（按记录号去重） */
export function unitPriceRecordCount(handoffs: ReadonlyArray<ResearchHandoffV1 | null>): number {
  const seen = new Set<string>();
  for (const h of handoffs) {
    for (const r of recordsOf(h)) if (r.unitPrice !== null) seen.add(r.recordId);
  }
  return seen.size;
}

export const MIN_COMPARABLE_AWARDS = 3;

export type Wave2Decision = { run: boolean; reasonZh: string };

/** 第二波甲：② 一条授标记录都没有 → 同类项目（补查） */
export function decideWave2Full(prior: ResearchHandoffV1 | null): Wave2Decision {
  return priorAwardsFoundNothing(prior)
    ? { run: true, reasonZh: "往期同标没查到成条的授标，继续查同类项目" }
    : { run: false, reasonZh: `无需追查：往期同标查到了 ${recordsOf(prior).length} 条` };
}

/** 第二波乙：③（含第二波甲）能算出单价的同类记录不足 3 条 → 放宽 */
export function decideWave2Relaxed(similar: ReadonlyArray<ResearchHandoffV1 | null>): Wave2Decision {
  const n = unitPriceRecordCount(similar);
  return n < MIN_COMPARABLE_AWARDS
    ? { run: true, reasonZh: `能算出单价的同类授标只有 ${n} 条，放宽到数量不限、近 6 年、加上美国` }
    : { run: false, reasonZh: `无需追查：同类授标已有 ${n} 条能算单价` };
}

/**
 * 摘要（所有项目读者可见）里能放的名字：不含任何数字、货币符号、@、协议、形如域名的写法（宁可少列：
 * 带数字的公司名不进摘要，详情仍在这一支的交接单里）
 */
export function isSafeSummaryName(s: string): boolean {
  const t = s.normalize("NFKC").replace(/\p{Cf}/gu, "").trim();
  if (!t || t.length > 120) return false;
  if (/\p{Nd}/u.test(t)) return false;
  if (/[$€£¥@]|:\/\/|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(t)) return false;
  return true;
}

/** 待反查：② 的记录里的中标方名（去重、保留先后，最多 10 个；只收 isSafeSummaryName 的） */
export function pendingReverseOf(prior: ResearchHandoffV1 | null): string[] {
  const out: string[] = [];
  const names = [
    ...recordsOf(prior).map((r) => r.fields.winner?.value ?? ""),
    ...(prior?.found ?? []).filter((f) => f.factType === "winner").map((f) => f.value),
  ];
  for (const raw of names) {
    if (!raw) continue;
    const name = raw.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
    if (!isSafeSummaryName(name)) continue;
    if (!out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= RESEARCH_TREE_LIMITS.MAX_PENDING_REVERSE) break;
  }
  return out;
}

/** 规则表里能自动长出来的分支类别（本批第二波的两类由上面两条规则决定，模型建议不触发任何自动生长） */
export const RULE_TABLE_KINDS: ReadonlySet<string> = new Set(["similar_full", "similar_relaxed"]);

/** 未追的线索的类别：只收小写英文与下划线（模型写的理由不进摘要） */
export const LEAD_KIND_RE = /^[a-z][a-z_]{0,39}$/;

/** 未追的线索：各支建议的分支类别，去重（最多 20 个）。规则表里的两类已由规则处理，不重复列 */
export function unchasedLeadsOf(handoffs: ReadonlyArray<ResearchHandoffV1 | null>): Array<{ kind: string }> {
  const out: Array<{ kind: string }> = [];
  const seen = new Set<string>();
  for (const h of handoffs) {
    for (const raw of h?.suggestedBranches ?? []) {
      const kind = typeof raw?.kind === "string" ? raw.kind.trim() : "";
      if (!LEAD_KIND_RE.test(kind) || RULE_TABLE_KINDS.has(kind) || seen.has(kind)) continue;
      seen.add(kind);
      out.push({ kind });
      if (out.length >= RESEARCH_TREE_LIMITS.MAX_UNCHASED_LEADS) return out;
    }
  }
  return out;
}

/** 事实的去重键：网址 + 组 + 类型 + 值（同一页不同组的同值事实各自保留：两笔授标可以是同一年） */
export function factKey(f: Pick<FoundFact, "url" | "factType" | "value" | "group">): string {
  return `${f.url}\u0000${(f.group ?? "").trim().toLowerCase()}\u0000${f.factType}\u0000${f.value.trim().toLowerCase()}`;
}

/** 同一支内同网址同组同类型同值的事实去重 */
export function dedupeFacts(facts: readonly FoundFact[]): FoundFact[] {
  const seen = new Set<string>();
  const out: FoundFact[] = [];
  for (const f of facts) {
    const k = factKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
