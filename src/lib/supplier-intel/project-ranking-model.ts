/**
 * S4-B：项目级「当前推荐」与「供应商赛马」的纯 read-model 逻辑。
 *
 *   - PRIMARY / BACKUP **只在这里动态派生**，永远不写回已完成的 Candidate（§42：昨天 A=PRIMARY、
 *     今天 B 更高 → 不改写 A；历史评估记录本身不动）。
 *   - 进入排名的硬条件（§44）：门 PASS + 四维与总分齐全 + 候选态不是 HIGH_RISK / NEEDS_VERIFICATION /
 *     NOT_ELIGIBLE。
 *   - 排序冻结（§45）：total ↓ technical ↓ commercial ↓ reliability ↓ importRisk ↓ candidateId ↑。
 *   - 赛马态 / 下一步动作全部确定性派生（§48–§50），不用 LLM。
 *
 * 纯模块：无 IO / 无时钟。
 */

import type { RacingState } from "./constants";

export interface RankableCandidateInput {
  candidateId: string;
  supplierId: string;
  offeringId: string | null;
  mandatoryGateResult: string;
  recommendation: string | null;
  scores: { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null; total: number | null };
}

export type RankingSection = "PRIMARY" | "BACKUP" | "NEEDS_VERIFICATION" | "HIGH_RISK" | "NOT_ELIGIBLE";

export interface RankedCandidate extends RankableCandidateInput {
  eligible: boolean;
  /** 只有 eligible 才有名次（1 = PRIMARY） */
  rank: number | null;
  section: RankingSection;
  /** 排名原因（可见） */
  ineligibleReason: "GATE_NOT_PASS" | "SCORE_INCOMPLETE" | "CANDIDATE_NOT_ELIGIBLE" | "CANDIDATE_NEEDS_VERIFICATION" | "CANDIDATE_HIGH_RISK" | null;
}

export function isRankingEligible(c: RankableCandidateInput): { eligible: boolean; reason: RankedCandidate["ineligibleReason"] } {
  if (c.recommendation === "NOT_ELIGIBLE") return { eligible: false, reason: "CANDIDATE_NOT_ELIGIBLE" };
  if (c.recommendation === "HIGH_RISK") return { eligible: false, reason: "CANDIDATE_HIGH_RISK" };
  if (c.recommendation === "NEEDS_VERIFICATION") return { eligible: false, reason: "CANDIDATE_NEEDS_VERIFICATION" };
  if (c.mandatoryGateResult !== "PASS") return { eligible: false, reason: "GATE_NOT_PASS" };
  const s = c.scores;
  if (s.technical === null || s.commercial === null || s.reliability === null || s.importRisk === null || s.total === null) return { eligible: false, reason: "SCORE_INCOMPLETE" };
  return { eligible: true, reason: null };
}

/** 冻结排序（§45） */
export function compareRankable(a: RankableCandidateInput, b: RankableCandidateInput): number {
  const keys: Array<keyof RankableCandidateInput["scores"]> = ["total", "technical", "commercial", "reliability", "importRisk"];
  for (const k of keys) {
    const d = (b.scores[k] ?? -1) - (a.scores[k] ?? -1);
    if (d !== 0) return d;
  }
  return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
}

export function rankCandidates(input: RankableCandidateInput[]): RankedCandidate[] {
  const eligible = input.filter((c) => isRankingEligible(c).eligible).sort(compareRankable);
  const rankById = new Map(eligible.map((c, i) => [c.candidateId, i + 1]));
  return input.map((c) => {
    const e = isRankingEligible(c);
    const rank = rankById.get(c.candidateId) ?? null;
    let section: RankingSection;
    if (e.eligible) section = rank === 1 ? "PRIMARY" : "BACKUP";
    else if (e.reason === "CANDIDATE_NOT_ELIGIBLE" || e.reason === "GATE_NOT_PASS" && c.mandatoryGateResult === "FAIL") section = "NOT_ELIGIBLE";
    else if (e.reason === "CANDIDATE_HIGH_RISK") section = "HIGH_RISK";
    else section = "NEEDS_VERIFICATION";
    return { ...c, eligible: e.eligible, rank, section, ineligibleReason: e.reason };
  }).sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.candidateId < b.candidateId ? -1 : 1;
  });
}

/* ───────────────── 赛马态 + 下一步动作（确定性） ───────────────── */

export interface RacingFacts {
  linked: boolean;
  hasOffering: boolean;
  /** 已核实证据（VERIFIED 证书 / VERIFIED 能力）条数 */
  verifiedEvidenceCount: number;
  /** CLAIMED 证书条数（提示核验证书） */
  claimedCertificationCount: number;
  latestGate: string | null;
  latestRecommendation: string | null;
  scoreComplete: boolean;
  /** 同项目已确认 RFQ */
  rfqConfirmed: boolean;
  /** 同项目已发出但未确认的询价 */
  rfqSent: boolean;
  priceEvidenceTier: string | null;
  unknownComponents: string[];
  evaluationInProgress: boolean;
}

export function deriveRacingState(f: RacingFacts): RacingState {
  if (f.latestRecommendation === "NOT_ELIGIBLE") return "NOT_ELIGIBLE";
  if (f.latestRecommendation === "HIGH_RISK") return "HIGH_RISK";
  if (f.latestGate === "PASS" && f.scoreComplete) return "SCORED";
  if (f.latestGate === "PASS" && f.rfqConfirmed) return "RFQ_CONFIRMED";
  if (f.latestGate === "PASS") return "GATE_PASS";
  if (f.latestRecommendation === "NEEDS_VERIFICATION" || f.latestGate === "INCOMPLETE") return "NEEDS_VERIFICATION";
  if (f.verifiedEvidenceCount > 0) return "EVIDENCE_READY";
  if (f.hasOffering) return "OFFERING_READY";
  if (f.linked) return "LINKED";
  return "FOUND";
}

export interface NextAction { code: string; label: string }

export function deriveNextAction(f: RacingFacts): NextAction {
  if (!f.linked) return { code: "LINK_SUPPLIER", label: "确认身份并关联供应商" };
  if (!f.hasOffering) return { code: "REGISTER_OFFERING", label: "登记具体型号 / 产品" };
  if (f.latestRecommendation === "NOT_ELIGIBLE") return { code: "NOT_ELIGIBLE", label: "强制项不通过：不进入推荐候选" };
  if (f.evaluationInProgress && f.latestGate !== "PASS") return { code: "CONTINUE_EVALUATION", label: "继续完成评估（判定 + 强制项）" };
  if (f.latestGate === null) return { code: "START_EVALUATION", label: "开始项目评估" };
  if (f.latestGate === "INCOMPLETE" || f.latestGate === "PENDING") return { code: "COMPLETE_MANDATORY_EVIDENCE", label: "补齐强制项证据" };
  if (f.claimedCertificationCount > 0 && f.verifiedEvidenceCount === 0) return { code: "VERIFY_CERTIFICATION", label: "核验证书" };
  if (!f.rfqConfirmed) return { code: "SEND_RFQ", label: f.rfqSent ? "等待厂家正式回复报价" : "向厂家正式询价" };
  if (f.unknownComponents.includes("commercial")) return { code: "WAIT_COMPARABLE_QUOTE", label: "等待同轮可比报价" };
  if (f.unknownComponents.includes("reliability")) return { code: "BUILD_HISTORY", label: "新供应商：需要更多交互 / 样品验证" };
  if (f.unknownComponents.includes("importRisk")) return { code: "VERIFY_EXPORT", label: "核实出口加拿大能力" };
  if (f.unknownComponents.includes("technical")) return { code: "COMPLETE_TECHNICAL", label: "补齐技术项判定" };
  if (f.latestRecommendation === "HIGH_RISK") return { code: "MITIGATE_RISK", label: "重大风险：补强出口 / 履约证据后重新评估" };
  if (!f.scoreComplete) return { code: "REEVALUATE", label: "重新评估以获得正式评分" };
  return { code: "IN_RANKING", label: "已进入当前项目排名" };
}
