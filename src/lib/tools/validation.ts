export const TOOL_CATEGORIES = ["builtin", "api", "internal", "integration"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_TYPES = ["http", "function", "builtin"] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_STATUSES = ["active", "archived"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export function isValidToolCategory(c: string): c is ToolCategory {
  return (TOOL_CATEGORIES as readonly string[]).includes(c);
}

export function isValidToolType(t: string): t is ToolType {
  return (TOOL_TYPES as readonly string[]).includes(t);
}

export function isValidToolStatus(s: string): s is ToolStatus {
  return (TOOL_STATUSES as readonly string[]).includes(s);
}

export function normalizeToolKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function isValidToolKeyFormat(key: string): boolean {
  return (
    /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(key) || /^[a-z0-9]$/.test(key)
  );
}
