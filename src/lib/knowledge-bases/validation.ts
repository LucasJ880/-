export const KB_SOURCE_TYPES = ["manual", "link", "file_stub"] as const;
export type KbSourceType = (typeof KB_SOURCE_TYPES)[number];

export const KB_STATUS = ["active", "archived"] as const;
export type KbStatus = (typeof KB_STATUS)[number];

export const DOC_STATUS = ["active", "archived"] as const;
export type DocStatus = (typeof DOC_STATUS)[number];

export function isValidKbSourceType(t: string): t is KbSourceType {
  return (KB_SOURCE_TYPES as readonly string[]).includes(t);
}

export function isValidKbStatus(s: string): s is KbStatus {
  return (KB_STATUS as readonly string[]).includes(s);
}

export function isValidDocStatus(s: string): s is DocStatus {
  return (DOC_STATUS as readonly string[]).includes(s);
}

/** 与 Prompt key 规则一致：小写、数字、下划线、短横线 */
export function normalizeKbKey(raw: string): string {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return k;
}

export function isValidKbKeyFormat(key: string): boolean {
  return (
    /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(key) || /^[a-z0-9]$/.test(key)
  );
}
