export const PROMPT_TYPES = ["system", "assistant", "workflow"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export const PROMPT_STATUS = ["active", "archived"] as const;
export type PromptStatus = (typeof PROMPT_STATUS)[number];

export function isValidPromptType(t: string): t is PromptType {
  return (PROMPT_TYPES as readonly string[]).includes(t);
}

export function isValidPromptStatus(s: string): s is PromptStatus {
  return (PROMPT_STATUS as readonly string[]).includes(s);
}

/**
 * key：小写、数字、下划线、短横线，1–64 字符
 */
export function normalizePromptKey(raw: string): string {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return k;
}

export function isValidPromptKeyFormat(key: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(key) || /^[a-z0-9]$/.test(key);
}
