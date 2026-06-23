/**
 * AI Grader 共享：统一评分逻辑。
 *
 * 初始 100；MEDIUM −8 / HIGH −15 / CRITICAL −25；最低 0。
 * 阈值：≥85 LOW / 70–84 MEDIUM / 50–69 HIGH / <50 CRITICAL。
 * 兜底：有 CRITICAL → 至少 CRITICAL；≥2 个 HIGH → 至少 HIGH。
 */

import type { RiskLevel } from "../types";

const PENALTY: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 8,
  HIGH: 15,
  CRITICAL: 25,
};

const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 85) return "LOW";
  if (score >= 70) return "MEDIUM";
  if (score >= 50) return "HIGH";
  return "CRITICAL";
}

/**
 * 根据风险等级列表计算 score + riskLevel（含兜底升级）。
 */
export function computeScoreAndRisk(levels: RiskLevel[]): {
  score: number;
  riskLevel: RiskLevel;
} {
  let score = 100;
  let highCount = 0;
  let criticalCount = 0;
  for (const level of levels) {
    score -= PENALTY[level];
    if (level === "HIGH") highCount++;
    if (level === "CRITICAL") criticalCount++;
  }
  score = Math.max(0, score);

  let riskLevel = scoreToRiskLevel(score);
  if (criticalCount > 0) riskLevel = "CRITICAL";
  else if (highCount >= 2 && RISK_RANK[riskLevel] < RISK_RANK.HIGH) riskLevel = "HIGH";

  return { score, riskLevel };
}
