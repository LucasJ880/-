/**
 * S4-B：候选推荐态契约（recommendation-contract-v1）。
 *
 * 阈值集中在这里，不散在 UI。纯模块：不 import 任何东西，无 IO / 无时钟。
 *
 * 候选**自身**只持久化稳定状态：
 *   FAIL                         → NOT_ELIGIBLE
 *   INCOMPLETE                   → NEEDS_VERIFICATION
 *   PASS 但评分证据不完整        → NEEDS_VERIFICATION
 *   PASS + 四维齐全 + 已知重大风险 → HIGH_RISK
 *   PASS + 四维齐全 + 无重大风险  → null（可进入项目级动态排名；PRIMARY / BACKUP 是 read-model，
 *                                   永远不写回已完成候选）
 */

export const RECOMMENDATION_CONTRACT_V1 = {
  version: "recommendation-contract-v1",
  highRisk: {
    /** importRiskScore < 50 → HIGH_RISK */
    importRiskBelow: 50,
    /** reliabilityScore < 40 → HIGH_RISK */
    reliabilityBelow: 40,
  },
} as const;

export type PersistedRecommendation = "NOT_ELIGIBLE" | "NEEDS_VERIFICATION" | "HIGH_RISK" | null;

export interface RecommendationInput {
  gateResult: string;
  components: { technical: number | null; commercial: number | null; reliability: number | null; importRisk: number | null };
  /** 只有四维齐全（knownWeightShare == 1）时才非 null */
  officialTotalScore: number | null;
}

export interface RecommendationOutcome {
  recommendation: PersistedRecommendation;
  /** 可进入项目级当前排名 */
  rankable: boolean;
  reasonCodes: Array<"GATE_FAIL" | "GATE_INCOMPLETE" | "OFFICIAL_TOTAL_INCOMPLETE" | "HIGH_RISK_IMPORT" | "HIGH_RISK_RELIABILITY">;
}

export function deriveCandidateRecommendation(input: RecommendationInput): RecommendationOutcome {
  if (input.gateResult === "FAIL") return { recommendation: "NOT_ELIGIBLE", rankable: false, reasonCodes: ["GATE_FAIL"] };
  if (input.gateResult !== "PASS") return { recommendation: "NEEDS_VERIFICATION", rankable: false, reasonCodes: ["GATE_INCOMPLETE"] };
  const c = input.components;
  const complete = c.technical !== null && c.commercial !== null && c.reliability !== null && c.importRisk !== null && input.officialTotalScore !== null;
  if (!complete) return { recommendation: "NEEDS_VERIFICATION", rankable: false, reasonCodes: ["OFFICIAL_TOTAL_INCOMPLETE"] };
  const reasons: RecommendationOutcome["reasonCodes"] = [];
  if ((c.importRisk as number) < RECOMMENDATION_CONTRACT_V1.highRisk.importRiskBelow) reasons.push("HIGH_RISK_IMPORT");
  if ((c.reliability as number) < RECOMMENDATION_CONTRACT_V1.highRisk.reliabilityBelow) reasons.push("HIGH_RISK_RELIABILITY");
  if (reasons.length > 0) return { recommendation: "HIGH_RISK", rankable: false, reasonCodes: reasons };
  return { recommendation: null, rankable: true, reasonCodes: [] };
}
