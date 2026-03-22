/**
 * 项目讨论 — 权限校验
 *
 * 规则：
 * 1. super_admin 可查看和发送所有项目讨论
 * 2. 项目 owner 可查看和发送
 * 3. 项目活跃成员（ProjectMember.status=active）可查看和发送
 * 4. 项目所属组织的 org_admin 可查看和发送（仅限本组织项目）
 * 5. 被移除成员不可发送新消息，也不可查看
 * 6. 非项目相关人员返回 false
 *
 * archived/completed 规则（方案 A）：
 * - 所有有权限的用户都可查看历史讨论
 * - 仅 owner 和 super_admin 可在 archived/completed 项目继续发言
 * - 普通成员在 archived/completed 项目只读
 */

import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { AuthUser } from "@/lib/auth";

interface ProjectForAccess {
  ownerId: string;
  orgId: string | null;
  status: string;
  intakeStatus: string;
}

async function getProjectForAccess(projectId: string): Promise<ProjectForAccess | null> {
  return db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, orgId: true, status: true, intakeStatus: true },
  });
}

async function isActiveMember(userId: string, projectId: string): Promise<boolean> {
  const pm = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { status: true },
  });
  return pm?.status === "active";
}

async function isOrgAdminOfProject(userId: string, orgId: string): Promise<boolean> {
  const om = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, status: true },
  });
  return om?.status === "active" && om.role === "org_admin";
}

function hasViewAccess(
  user: AuthUser,
  project: ProjectForAccess,
  memberActive: boolean,
  orgAdmin: boolean
): boolean {
  if (isSuperAdmin(user.role)) return true;
  if (project.intakeStatus !== "dispatched") return false;
  if (project.ownerId === user.id) return true;
  if (memberActive) return true;
  if (project.orgId && orgAdmin) return true;
  return false;
}

const READONLY_STATUSES = new Set(["archived", "completed"]);

export async function canViewProjectDiscussion(
  user: AuthUser,
  projectId: string
): Promise<boolean> {
  const project = await getProjectForAccess(projectId);
  if (!project) return false;

  const memberActive = await isActiveMember(user.id, projectId);
  const orgAdmin = project.orgId
    ? await isOrgAdminOfProject(user.id, project.orgId)
    : false;

  return hasViewAccess(user, project, memberActive, orgAdmin);
}

export async function canPostProjectMessage(
  user: AuthUser,
  projectId: string
): Promise<boolean> {
  const project = await getProjectForAccess(projectId);
  if (!project) return false;

  if (isSuperAdmin(user.role)) return true;
  if (project.intakeStatus !== "dispatched") return false;

  if (READONLY_STATUSES.has(project.status)) {
    return project.ownerId === user.id;
  }

  const memberActive = await isActiveMember(user.id, projectId);
  if (project.ownerId === user.id) return true;
  if (memberActive) return true;
  if (project.orgId) {
    const orgAdmin = await isOrgAdminOfProject(user.id, project.orgId);
    if (orgAdmin) return true;
  }

  return false;
}
