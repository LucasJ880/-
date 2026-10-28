/**
 * Visualizer 请求级企业解析（visualizer-org-boundary）
 *
 * - 沿用销售区 resolveSalesOrgIdForRequest：普通用户取 activeOrgId（唯一企业时取该企业），
 *   带的 orgId 只做交叉校验；平台 admin / super_admin 必须显式 orgId。
 * - 额外：平台 super_admin 以外的人必须是该企业活跃成员——
 *   否则平台 admin 带任意 orgId 即可跨企业（resolveTradeOrgId 对 admin 只校验企业存在）。
 * - super_admin 在任一企业内全权，但仍限定在所带企业（与 platformAdminBindings 的 ORG 范围一致）。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { resolveSalesOrgIdForRequest, type SalesOrgResolution } from "@/lib/sales/org-context";

export async function resolveVisualizerOrgId(
  request: NextRequest,
  user: AuthUser,
): Promise<SalesOrgResolution> {
  const resolved = await resolveSalesOrgIdForRequest(request, user);
  if (!resolved.ok) return resolved;
  if (isPlatformSuperAdmin(user.role)) return resolved;

  const membership = await getOrgMembership(user.id, resolved.orgId);
  if (membership?.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问该组织的可视化方案" }, { status: 403 }),
    };
  }
  return resolved;
}

/** 已从资源读出 orgId 的场景（如文件代理）：super_admin 或该企业活跃成员 */
export async function canUseVisualizerOrg(user: AuthUser, orgId: string): Promise<boolean> {
  if (isPlatformSuperAdmin(user.role)) return true;
  const membership = await getOrgMembership(user.id, orgId);
  return membership?.status === "active";
}
