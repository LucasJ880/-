import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getOrgMembership, getProjectMembership } from "./index";
import type { AuthUser } from "./index";
import {
  isSuperAdmin,
  hasOrgRole,
  hasProjectRole,
  type OrgRole,
  type ProjectRole,
} from "@/lib/rbac/roles";

// ============================================================
// API 路由守卫
// 用法: 在 route handler 开头调用，不通过则直接返回 NextResponse
// ============================================================

interface AuthResult {
  user: AuthUser;
}

interface OrgAuthResult extends AuthResult {
  orgRole: string;
}

interface ProjectAuthResult extends AuthResult {
  orgRole: string | null;
  projectRole: string;
}

/**
 * 基础登录态校验
 *
 * @example
 * export async function GET(request: NextRequest) {
 *   const auth = await requireAuth(request);
 *   if (auth instanceof NextResponse) return auth;
 *   const { user } = auth;
 *   // ...
 * }
 */
export async function requireAuth(
  request: NextRequest
): Promise<AuthResult | NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.status !== "active") {
    return NextResponse.json({ error: "账号已停用" }, { status: 403 });
  }
  return { user };
}

/**
 * 平台管理员校验
 */
export async function requireSuperAdmin(
  request: NextRequest
): Promise<AuthResult | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;

  if (!isSuperAdmin(result.user.role)) {
    return NextResponse.json({ error: "需要平台管理员权限" }, { status: 403 });
  }
  return result;
}

/**
 * 组织级角色校验
 *
 * @param orgId - 目标组织 ID（从路由参数或请求体中获取）
 * @param minRole - 最低要求的组织角色
 *
 * @example
 * const auth = await requireOrgRole(request, orgId, "org_member");
 * if (auth instanceof NextResponse) return auth;
 * const { user, orgRole } = auth;
 */
export async function requireOrgRole(
  request: NextRequest,
  orgId: string,
  minRole: OrgRole
): Promise<OrgAuthResult | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;

  const { user } = result;

  if (isSuperAdmin(user.role)) {
    return { user, orgRole: "org_admin" };
  }

  const membership = await getOrgMembership(user.id, orgId);
  if (!membership || membership.status !== "active") {
    return NextResponse.json({ error: "无权访问该组织" }, { status: 403 });
  }

  if (!hasOrgRole(membership.role, minRole)) {
    return NextResponse.json(
      { error: `需要 ${minRole} 及以上组织角色` },
      { status: 403 }
    );
  }

  return { user, orgRole: membership.role };
}

/**
 * 项目级角色校验
 *
 * @param orgId - 所属组织 ID
 * @param projectId - 目标项目 ID
 * @param minRole - 最低要求的项目角色
 *
 * @example
 * const auth = await requireProjectRole(request, orgId, projectId, "operator");
 * if (auth instanceof NextResponse) return auth;
 * const { user, projectRole } = auth;
 */
export async function requireProjectRole(
  request: NextRequest,
  orgId: string,
  projectId: string,
  minRole: ProjectRole
): Promise<ProjectAuthResult | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;

  const { user } = result;

  if (isSuperAdmin(user.role)) {
    return { user, orgRole: "org_admin", projectRole: "project_admin" };
  }

  const orgMembership = await getOrgMembership(user.id, orgId);
  const orgRole = orgMembership?.status === "active" ? orgMembership.role : null;

  if (orgRole && hasOrgRole(orgRole, "org_admin")) {
    return { user, orgRole, projectRole: "project_admin" };
  }

  const projectMembership = await getProjectMembership(user.id, projectId);
  if (!projectMembership || projectMembership.status !== "active") {
    return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
  }

  if (!hasProjectRole(projectMembership.role, minRole)) {
    return NextResponse.json(
      { error: `需要 ${minRole} 及以上项目角色` },
      { status: 403 }
    );
  }

  return { user, orgRole, projectRole: projectMembership.role };
}
