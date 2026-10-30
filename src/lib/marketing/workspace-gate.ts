/**
 * PERM-4c5：营销工作区页面（/marketing/**、/operations/growth/**）的服务端门槛。
 * 岗位模式企业按岗位派生平台角色拦销售（压扁后 JWT 角色为 user，中间件不再拦）；旧模式派生角色 = 平台角色，与中间件一致。
 */

import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { canAccessMarketingWorkspace } from "@/lib/marketing/route-access";

export async function guardMarketingWorkspacePage(): Promise<void> {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  const role = deriveEffectivePlatformRole({
    platformRole: session.ctx.platformRole,
    positionMode: Boolean(session.ctx.positionMode),
    permissionKeys: session.ctx.permissionKeys,
  });
  if (!canAccessMarketingWorkspace(role)) redirect("/sales");
}
