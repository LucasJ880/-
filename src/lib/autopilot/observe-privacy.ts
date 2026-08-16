/**
 * Observe Dashboard privacy / field-name locks.
 * Dashboard APIs must not expose raw prompts, credentials, or quality scores.
 */

export const FORBIDDEN_OBSERVE_SCORE_KEYS = [
  "successRate",
  "taskSuccessRate",
  "negativeFeedback",
  "badResponseCount",
  "hallucinationScore",
  "correctnessScore",
  "helpfulnessScore",
  "employeeScore",
  "aiQualityScore",
  "overallAiScore",
  "userSatisfaction",
] as const;

export const FORBIDDEN_OBSERVE_NEEDLES = [
  "Bearer ",
  "Authorization",
  "Cookie",
  "password",
  "API key",
  "api_key",
  "OAuth",
  "sk-live-",
  "sk-proj-",
] as const;

function collectKeys(value: unknown, out: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    collectKeys(nested, out);
  }
}

export function forbiddenObserveScoreKeys(payload: unknown): string[] {
  const keys: string[] = [];
  collectKeys(payload, keys);
  const found = new Set(keys);
  return FORBIDDEN_OBSERVE_SCORE_KEYS.filter((key) => found.has(key));
}

export function forbiddenObserveNeedles(payload: unknown): string[] {
  const json = JSON.stringify(payload ?? {});
  return FORBIDDEN_OBSERVE_NEEDLES.filter((needle) => json.includes(needle));
}

export function scanObserveResponse(payload: unknown): {
  scoreKeys: string[];
  needles: string[];
  ok: boolean;
} {
  const scoreKeys = forbiddenObserveScoreKeys(payload);
  const needles = forbiddenObserveNeedles(payload);
  return { scoreKeys, needles, ok: scoreKeys.length === 0 && needles.length === 0 };
}
