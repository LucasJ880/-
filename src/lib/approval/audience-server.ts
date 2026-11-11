/**
 * VIS-1d：按用户与企业取审批可见集合的判定输入（design D5）。
 *
 * - 平台角色按 userId 从库里读，不信调用方传的 role（审批中心经端口执行时传的是组织角色）。
 * - 判定输入走路由门加载器的 (userId, orgId) 30 秒缓存（不列计数、不写库）。
 * - 企业处理人与执行器同口径：企业所有者（Organization.ownerId）或成员角色 org_admin（team.ts）。
 */

import { db } from "@/lib/db";
import { ROUTE_GATE_LOADER } from "@/lib/navigation/context-server";
import { isOrgSystemAdmin, isSuperAdmin } from "@/lib/rbac/roles";
import type { ApprovalViewer } from "./audience";

export async function loadApprovalViewer(userId: string, orgId: string | null): Promise<ApprovalViewer> {
  const user = await ROUTE_GATE_LOADER.loadUser(userId);
  const isPlatformAdmin = !!user && user.status === "active" && isSuperAdmin(user.role ?? "");
  const empty: ApprovalViewer = {
    userId,
    orgId,
    isPlatformAdmin,
    isOrgHandler: false,
    isOrgAdminRole: false,
    workspaceIds: [],
    projectIds: [],
    ctx: null,
  };
  if (!user || user.status !== "active" || !orgId) return empty;

  const [ctx, org, member, workspaces, ownedProjects, adminProjects] = await Promise.all([
    ROUTE_GATE_LOADER.loadContextForOrg(user, orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } }),
    db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true, status: true },
    }),
    db.workspaceMember.findMany({
      where: { userId, status: "active", workspace: { orgId, status: "active" } },
      select: { workspaceId: true },
    }),
    db.project.findMany({ where: { orgId, ownerId: userId }, select: { id: true } }),
    db.projectMember.findMany({
      where: { userId, role: "project_admin", status: "active", project: { orgId } },
      select: { projectId: true },
    }),
  ]);
  const activeRole = member?.status === "active" ? member.role : null;
  return {
    ...empty,
    isOrgHandler: org?.ownerId === userId || activeRole === "org_admin",
    isOrgAdminRole: isOrgSystemAdmin(activeRole),
    workspaceIds: workspaces.map((w) => w.workspaceId),
    projectIds: [...new Set([...ownedProjects.map((p) => p.id), ...adminProjects.map((p) => p.projectId)])],
    ctx,
  };
}
