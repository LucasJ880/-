import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getOrgMembership, getProjectMembership } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin, hasOrgRole, hasProjectRole } from "@/lib/rbac/roles";
import type { Project } from "@prisma/client";

/**
 * 项目可见性统一入口 — 所有面向用户的项目查询/鉴权必须使用这些函数。
 * 详见 src/lib/projects/visibility.ts 中的开发约束。
 */
export { buildProjectVisibilityWhere, getVisibleProjectIds, canViewProject } from "./visibility";
export type { IntakeStatusFilter } from "./visibility";

export interface ProjectAccessContext {
  user: AuthUser;
  project: Project;
  orgRole: string | null;
  projectRole: string | null;
}

/**
 * 校验当前用户对项目的写权限（PATCH / DELETE）
 * - super_admin
 * - 项目 owner
 * - 组织 org_admin（项目有 orgId 时）
 * - 项目 project_admin
 */
export async function requireProjectWriteAccess(
  request: NextRequest,
  projectId: string
): Promise<ProjectAccessContext | NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (isSuperAdmin(user.role)) {
    return {
      user,
      project,
      orgRole: "org_admin",
      projectRole: "project_admin",
    };
  }

  if (project.intakeStatus !== "dispatched") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (project.ownerId === user.id) {
    let orgRole: string | null = null;
    let projectRole: string | null = null;
    if (project.orgId) {
      const om = await getOrgMembership(user.id, project.orgId);
      orgRole = om?.status === "active" ? om.role : null;
      const pm = await getProjectMembership(user.id, projectId);
      projectRole = pm?.status === "active" ? pm.role : null;
    }
    return { user, project, orgRole, projectRole };
  }

  if (project.orgId) {
    const om = await getOrgMembership(user.id, project.orgId);
    const orgRole = om?.status === "active" ? om.role : null;
    if (orgRole && hasOrgRole(orgRole, "org_admin")) {
      const pm = await getProjectMembership(user.id, projectId);
      const projectRole = pm?.status === "active" ? pm.role : null;
      return { user, project, orgRole, projectRole };
    }

    const pm = await getProjectMembership(user.id, projectId);
    const projectRole = pm?.status === "active" ? pm.role : null;
    if (projectRole && hasProjectRole(projectRole, "project_admin")) {
      return { user, project, orgRole, projectRole };
    }
  }

  return NextResponse.json({ error: "无权修改该项目" }, { status: 403 });
}

/**
 * 项目读权限：成员、owner、组织 org_admin、super_admin
 * 用于 GET 项目详情、成员列表、环境列表等
 */
export async function requireProjectReadAccess(
  request: NextRequest,
  projectId: string
): Promise<ProjectAccessContext | NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (isSuperAdmin(user.role)) {
    return {
      user,
      project,
      orgRole: "org_admin",
      projectRole: "project_admin",
    };
  }

  if (project.intakeStatus !== "dispatched") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let orgRole: string | null = null;
  if (project.orgId) {
    const om = await getOrgMembership(user.id, project.orgId);
    orgRole = om?.status === "active" ? om.role : null;
  }

  const pm = await getProjectMembership(user.id, projectId);
  const projectRole = pm?.status === "active" ? pm.role : null;

  if (project.ownerId === user.id) {
    return { user, project, orgRole, projectRole };
  }

  if (project.orgId && orgRole && hasOrgRole(orgRole, "org_admin")) {
    return { user, project, orgRole, projectRole };
  }

  if (projectRole) {
    return { user, project, orgRole, projectRole };
  }

  return NextResponse.json({ error: "无权查看该项目" }, { status: 403 });
}

/** 管理成员与环境：与写项目元数据权限一致 */
export const requireProjectManageAccess = requireProjectWriteAccess;
