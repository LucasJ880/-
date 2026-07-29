/**
 * 跨账号文案相似度（Phase C）
 * 阈值可配置，默认不硬编码到 UI。
 */

export type SimilarityResult = {
  similarityScore: number;
  comparedPublishJobIds: string[];
  duplicateRisk: "low" | "medium" | "high";
  explanation: string;
};

export type SimilarityThresholds = {
  warnAt: number;
  blockAt: number;
};

export const DEFAULT_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
  warnAt: 0.72,
  blockAt: 0.88,
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** Jaccard 词集相似度 0–1 */
export function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function assessCrossAccountSimilarity(input: {
  candidateText: string;
  peers: Array<{ publishJobId: string; text: string }>;
  thresholds?: SimilarityThresholds;
}): SimilarityResult {
  const thresholds = input.thresholds ?? DEFAULT_SIMILARITY_THRESHOLDS;
  let maxScore = 0;
  let maxId: string | null = null;
  const compared: string[] = [];

  for (const peer of input.peers) {
    compared.push(peer.publishJobId);
    const score = jaccardSimilarity(input.candidateText, peer.text);
    if (score > maxScore) {
      maxScore = score;
      maxId = peer.publishJobId;
    }
  }

  let duplicateRisk: SimilarityResult["duplicateRisk"] = "low";
  if (maxScore >= thresholds.blockAt) duplicateRisk = "high";
  else if (maxScore >= thresholds.warnAt) duplicateRisk = "medium";

  return {
    similarityScore: Math.round(maxScore * 1000) / 1000,
    comparedPublishJobIds: compared,
    duplicateRisk,
    explanation:
      maxId == null
        ? "无同行文案可比对"
        : `与任务 ${maxId} 相似度 ${(maxScore * 100).toFixed(1)}%（warn≥${thresholds.warnAt} block≥${thresholds.blockAt}）`,
  };
}
