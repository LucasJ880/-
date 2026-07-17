export const MARKETING_DIMENSIONS = [
  "AI_VISIBILITY",
  "SEO",
  "LISTINGS",
  "REVIEWS",
  "SOCIAL",
  "WEBSITE",
  "ADVERTISING",
] as const;

export type MarketingDimension = (typeof MARKETING_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<MarketingDimension, string> = {
  AI_VISIBILITY: "AI Visibility",
  SEO: "SEO",
  LISTINGS: "Listings",
  REVIEWS: "Reviews",
  SOCIAL: "Social",
  WEBSITE: "Website",
  ADVERTISING: "Advertising",
};

export const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function clampScore(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
