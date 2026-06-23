/**
 * AI Grader 共享：销售域 data-scope 解析。
 *
 * 与 src/lib/sales/org-context.ts 的 resolveSalesScope 逻辑一致：
 * - admin / super_admin → 全局（ownOnly=false）
 * - org_admin（active）→ 全局（ownOnly=false）
 * - 其余 → 仅本人（ownOnly=true）
 */

import { getOrgMembership } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac/roles";

export async function resolveSalesOwnOnly(
  userId: string,
  orgId: string,
  role: string,
): Promise<boolean> {
  if (isAdmin(role)) return false;
  const m = await getOrgMembership(userId, orgId);
  const isOrgAdmin = m?.status === "active" && m.role === "org_admin";
  return !isOrgAdmin;
}
