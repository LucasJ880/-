export const FEEDBACK_STATUSES = ["open", "triaged", "resolved", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const ISSUE_TYPES = [
  "hallucination",
  "irrelevance",
  "format_error",
  "unsafe",
  "tool_error",
  "kb_miss",
  "slow",
  "other",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const TAG_CATEGORIES = ["quality", "issue", "business", "reviewer"] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export function isValidRating(r: unknown): r is number {
  return typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 5;
}

export function isValidScore(s: unknown): boolean {
  return s === null || s === undefined || (typeof s === "number" && Number.isInteger(s) && s >= 1 && s <= 5);
}

export function isValidFeedbackStatus(s: string): s is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(s);
}

export function isValidSentiment(s: string): s is Sentiment {
  return (SENTIMENTS as readonly string[]).includes(s);
}

export function isValidIssueType(s: string): s is IssueType {
  return (ISSUE_TYPES as readonly string[]).includes(s);
}

export function isValidTagCategory(c: string): c is TagCategory {
  return (TAG_CATEGORIES as readonly string[]).includes(c);
}
