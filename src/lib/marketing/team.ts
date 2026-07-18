import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";

export const GROWTH_CENTER_WORKFLOW = "marketing_growth_center";

export async function ensureGrowthCenterProject(orgId: string, fallbackOwnerId: string) {
  const existing = await db.project.findFirst({
    where: { orgId, status: "active", workflowTemplate: GROWTH_CENTER_WORKFLOW },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return db.project.create({
    data: {
      orgId,
      name: "Growth Center 营销增长",
      description: "营销研究、计划、审批、执行与复盘的团队工作区",
      workflowTemplate: GROWTH_CENTER_WORKFLOW,
      ownerId: fallbackOwnerId,
      priority: "high",
      status: "active",
    },
  });
}

/**
 * 解析营销团队 Leader。优先使用显式 project_admin，其次组织 Owner / org_admin。
 * 若尚未配置 Leader，则回退到项目 owner，最后才回退到提交人。
 */
export async function resolveMarketingLeader(input: {
  orgId: string;
  projectId: string;
  requesterId: string;
}) {
  const [project, organization, projectAdmins, orgAdmins] = await Promise.all([
    db.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId, status: "active" },
      select: { ownerId: true },
    }),
    db.organization.findUnique({
      where: { id: input.orgId },
      select: { ownerId: true },
    }),
    db.projectMember.findMany({
      where: { projectId: input.projectId, role: "project_admin", status: "active" },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    }),
    db.organizationMember.findMany({
      where: { orgId: input.orgId, role: "org_admin", status: "active" },
      select: { userId: true },
      orderBy: { joinedAt: "asc" },
    }),
  ]);

  const candidates = [
    ...projectAdmins.map((row) => row.userId),
    organization?.ownerId,
    ...orgAdmins.map((row) => row.userId),
    project?.ownerId,
    input.requesterId,
  ].filter((value): value is string => Boolean(value));
  return candidates.find((id) => id !== input.requesterId) ?? candidates[0] ?? input.requesterId;
}

export interface TeamApprovalScope {
  createdById: string;
  orgId: string | null;
  projectId: string | null;
  approverUserId: string | null;
}

export interface TeamApprovalAccessSnapshot {
  isSuperAdmin: boolean;
  isOrgOwner: boolean;
  isOrgAdmin: boolean;
  isProjectOwner: boolean;
  isProjectAdmin: boolean;
}

export function canDecideTeamApprovalFromSnapshot(
  action: TeamApprovalScope,
  ctx: { userId: string; orgId?: string | null },
  access: TeamApprovalAccessSnapshot,
) {
  const isPersonal = !action.orgId && !action.projectId && !action.approverUserId;
  if (isPersonal) return action.createdById === ctx.userId;
  if (ctx.orgId && action.orgId && ctx.orgId !== action.orgId) return false;
  return access.isSuperAdmin
    || action.approverUserId === ctx.userId
    || access.isOrgOwner
    || access.isOrgAdmin
    || access.isProjectOwner
    || access.isProjectAdmin;
}

export async function getTeamApprovalAccessIds(userId: string) {
  const [ownedOrgs, orgAdmins, ownedProjects, projectAdmins] = await Promise.all([
    db.organization.findMany({ where: { ownerId: userId }, select: { id: true } }),
    db.organizationMember.findMany({
      where: { userId, role: "org_admin", status: "active" },
      select: { orgId: true },
    }),
    db.project.findMany({ where: { ownerId: userId, status: "active" }, select: { id: true } }),
    db.projectMember.findMany({
      where: { userId, role: "project_admin", status: "active" },
      select: { projectId: true },
    }),
  ]);
  return {
    orgIds: [...new Set([...ownedOrgs.map((row) => row.id), ...orgAdmins.map((row) => row.orgId)])],
    projectIds: [...new Set([...ownedProjects.map((row) => row.id), ...projectAdmins.map((row) => row.projectId)])],
  };
}

/** 旧草稿仍只允许创建人处理；团队草稿允许指定 Leader 或该范围管理员处理。 */
export async function canDecideTeamApproval(
  action: TeamApprovalScope,
  ctx: { userId: string; role: string | null | undefined; orgId?: string | null },
) {
  const personal = !action.orgId && !action.projectId && !action.approverUserId;
  if (personal) {
    return canDecideTeamApprovalFromSnapshot(action, ctx, {
      isSuperAdmin: isSuperAdmin(ctx.role ?? ""),
      isOrgOwner: false,
      isOrgAdmin: false,
      isProjectOwner: false,
      isProjectAdmin: false,
    });
  }
  if (ctx.orgId && action.orgId && ctx.orgId !== action.orgId) return false;

  let isOrgOwner = false;
  let isOrgAdmin = false;
  let isProjectOwner = false;
  let isProjectAdmin = false;

  if (action.orgId) {
    const organization = await db.organization.findUnique({
      where: { id: action.orgId },
      select: { ownerId: true },
    });
    isOrgOwner = organization?.ownerId === ctx.userId;
    const orgMember = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: action.orgId, userId: ctx.userId } },
      select: { role: true, status: true },
    });
    isOrgAdmin = orgMember?.status === "active" && orgMember.role === "org_admin";
  }

  if (action.projectId) {
    const project = await db.project.findUnique({
      where: { id: action.projectId },
      select: { ownerId: true, orgId: true },
    });
    if (!project || (action.orgId && project.orgId !== action.orgId)) return false;
    isProjectOwner = project.ownerId === ctx.userId;
    const projectMember = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: action.projectId, userId: ctx.userId } },
      select: { role: true, status: true },
    });
    isProjectAdmin = projectMember?.status === "active" && projectMember.role === "project_admin";
  }

  return canDecideTeamApprovalFromSnapshot(action, ctx, {
    isSuperAdmin: isSuperAdmin(ctx.role ?? ""),
    isOrgOwner,
    isOrgAdmin,
    isProjectOwner,
    isProjectAdmin,
  });
}
