import { MARKETING_DIMENSIONS, clampScore } from "./constants";

export interface DimensionScoreLike {
  dimension: string;
  score: number;
}

export function calculateMarketPresence(scores: DimensionScoreLike[]): number | null {
  const byDimension = new Map(scores.map((row) => [row.dimension, clampScore(row.score)]));
  const available = MARKETING_DIMENSIONS.map((dimension) => byDimension.get(dimension)).filter(
    (score): score is number => score !== undefined,
  );
  if (available.length === 0) return null;
  return Math.round(available.reduce((sum, score) => sum + score, 0) / available.length);
}

export function calculateGrowthExecution(input: {
  published: number;
  experiments: number;
  qualifiedLeads: number;
  wins: number;
  pendingReview: number;
}): number {
  const publishing = Math.min(30, input.published * 3);
  const experiments = Math.min(20, input.experiments * 5);
  const leads = Math.min(25, input.qualifiedLeads * 2.5);
  const wins = Math.min(25, input.wins * 8);
  const approvalPenalty = Math.min(10, input.pendingReview * 2);
  return clampScore(publishing + experiments + leads + wins - approvalPenalty);
}
