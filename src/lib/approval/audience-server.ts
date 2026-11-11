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
import { portCardVisible, type ApprovalItem, type ApprovalViewer } from "./audience";

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
  // VIS-1e：以岗位预览期间成员角色 org_member、不是企业所有者（平台角色已由加载器给成 user）
  const previewing = Boolean(user.previewFingerprint);
  return {
    ...empty,
    isOrgHandler: !previewing && (org?.ownerId === userId || activeRole === "org_admin"),
    isOrgAdminRole: !previewing && isOrgSystemAdmin(activeRole),
    workspaceIds: workspaces.map((w) => w.workspaceId),
    projectIds: [...new Set([...ownedProjects.map((p) => p.id), ...adminProjects.map((p) => p.projectId)])],
    ctx,
  };
}

/**
 * 单张卡的判定输入（design D5）：按卡所属企业取（不按调用方当前企业：微信传空）；调用方已取好、
 * 且用户与企业都相同时复用。没有企业、但挂了项目的卡，另按该项目判本人是否负责人 / project_admin
 * （与执行器对无企业卡的判定同源：Project.ownerId 与 active 的 project_admin 成员）。
 */
export async function viewerForCard(item: ApprovalItem, userId: string, viewer?: ApprovalViewer): Promise<ApprovalViewer> {
  let v = viewer && viewer.userId === userId && viewer.orgId === item.orgId ? viewer : await loadApprovalViewer(userId, item.orgId);
  if (!item.orgId && item.projectId && !v.projectIds.includes(item.projectId)) {
    const projectId = item.projectId;
    const [project, member] = await Promise.all([
      db.project.findUnique({ where: { id: projectId }, select: { ownerId: true } }),
      db.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true, status: true },
      }),
    ]);
    if (project?.ownerId === userId || (member?.status === "active" && member.role === "project_admin")) {
      v = { ...v, projectIds: [...v.projectIds, projectId] };
    }
  }
  return v;
}

/** 单张卡的端口判定（design D5 的 6 步） */
export async function cardVisibleTo(
  item: ApprovalItem,
  userId: string,
  callerOrgId: string | null | undefined,
  viewer?: ApprovalViewer,
): Promise<boolean> {
  return portCardVisible(item, await viewerForCard(item, userId, viewer), callerOrgId);
}
