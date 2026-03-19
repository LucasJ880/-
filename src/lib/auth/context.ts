import { db } from "@/lib/db";

// ============================================================
// 多租户上下文工具
//
// 隔离原则:
//   - Organization 是一级隔离边界（数据归属）
//   - Project 是业务隔离边界（任务/工艺单/日程等）
//   - Environment 是配置隔离边界（变量/运行参数等）
//
// 所有业务查询都应通过 context 注入 orgId / projectId，
// 避免跨租户数据泄漏。
// ============================================================

export interface OrgContext {
  orgId: string;
  orgName: string;
  orgCode: string;
  userId: string;
  orgRole: string;
}

export interface ProjectContext extends OrgContext {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  projectRole: string;
}

/**
 * 构建组织级上下文
 * 验证用户是否属于该组织，返回上下文信息
 */
export async function buildOrgContext(
  userId: string,
  orgId: string
): Promise<OrgContext | null> {
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    include: { org: true },
  });

  if (!membership || membership.status !== "active") return null;
  if (membership.org.status !== "active") return null;

  return {
    orgId: membership.org.id,
    orgName: membership.org.name,
    orgCode: membership.org.code,
    userId,
    orgRole: membership.role,
  };
}

/**
 * 构建项目级上下文
 * 验证用户是否有权访问该项目（通过组织或项目成员身份）
 */
export async function buildProjectContext(
  userId: string,
  orgId: string,
  projectId: string
): Promise<ProjectContext | null> {
  const orgCtx = await buildOrgContext(userId, orgId);
  if (!orgCtx) return null;

  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project || project.status !== "active") return null;

  const projectMembership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });

  const projectRole =
    orgCtx.orgRole === "org_admin"
      ? "project_admin"
      : projectMembership?.status === "active"
        ? projectMembership.role
        : null;

  if (!projectRole) return null;

  return {
    ...orgCtx,
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    projectRole,
  };
}
