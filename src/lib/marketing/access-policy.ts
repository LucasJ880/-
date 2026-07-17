import { isAdmin } from "@/lib/rbac/roles";

export type MarketingMembership = {
  role: string;
  status: string;
} | null;

/** 企业事实编辑策略：组织成员可维护，观察者只读。 */
export function canEditMarketingBrandProfile(
  platformRole: string | null | undefined,
  membership: MarketingMembership,
): boolean {
  if (isAdmin(platformRole ?? "") || platformRole === "manager") return true;
  if (membership?.status !== "active") return false;
  return membership.role === "org_admin" || membership.role === "org_member";
}
