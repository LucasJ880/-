/** ProjectSupplierLink.role — 存小写；API 接受大小写别名 */

export const SUPPLIER_LINK_ROLES = [
  "candidate",
  "shortlisted",
  "selected",
  "rejected",
] as const;

export type SupplierLinkRole = (typeof SUPPLIER_LINK_ROLES)[number];

const ALIASES: Record<string, SupplierLinkRole> = {
  candidate: "candidate",
  CANDIDATE: "candidate",
  shortlisted: "shortlisted",
  SHORTLISTED: "shortlisted",
  selected: "selected",
  SELECTED: "selected",
  rejected: "rejected",
  REJECTED: "rejected",
};

export const SUPPLIER_LINK_ROLE_LABELS: Record<SupplierLinkRole, string> = {
  candidate: "候选",
  shortlisted: "短名单",
  selected: "已入选",
  rejected: "未入选",
};

export function normalizeSupplierLinkRole(
  raw: string | null | undefined,
): SupplierLinkRole | null {
  if (!raw) return null;
  return ALIASES[raw] ?? ALIASES[raw.toLowerCase()] ?? null;
}

export function isSupplierLinkRole(v: string): v is SupplierLinkRole {
  return (SUPPLIER_LINK_ROLES as readonly string[]).includes(v);
}
