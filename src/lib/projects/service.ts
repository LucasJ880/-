/**
 * Projects 服务层
 *
 * ⚠️ 重要约束：
 * 所有返回项目列表/详情的函数必须遵守 intakeStatus 可见性规则：
 * - intakeStatus === "pending_dispatch" 的项目仅 super_admin 可见
 * - 普通用户的查询必须包含 intakeStatus: "dispatched"
 *
 * 如果需要绕过此限制（如内部系统操作），请明确标注 @internal。
 * 面向用户的 API 应优先使用 src/lib/projects/visibility.ts 中的：
 * - buildProjectVisibilityWhere(user)
 * - getVisibleProjectIds(userId, role)
 * - canViewProject(user, project)
 */

import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams, TenantScope } from "@/lib/common/types";
import { normalizePagination } from "@/lib/common/validation";

export interface ProjectListItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  color: string;
  status: string;
  createdAt: Date;
  owner: { id: string; name: string; avatar: string | null };
  _count: { members: number; environments: number };
}

/**
 * 获取组织下的项目列表（多租户隔离查询）
 *
 * 已内置 intakeStatus 可见性过滤：
 * - isSuperAdmin=true 时返回全部
 * - 否则仅返回 intakeStatus="dispatched"
 */
export async function listProjectsByOrg(
  scope: Pick<TenantScope, "orgId">,
  params?: PaginationParams & { status?: string; search?: string },
  opts?: { isSuperAdmin?: boolean }
): Promise<PaginatedResult<ProjectListItem>> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where: Record<string, unknown> = { orgId: scope.orgId };
  if (!opts?.isSuperAdmin) {
    where.intakeStatus = "dispatched";
  }
  if (params?.status) where.status = params.status;
  if (params?.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { code: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    db.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        color: true,
        status: true,
        createdAt: true,
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true, environments: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.project.count({ where }),
  ]);

  return {
    data: data as ProjectListItem[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取用户可访问的项目列表（跨组织）
 *
 * 已内置 intakeStatus 可见性过滤：
 * - super_admin 返回全部 active 项目
 * - 普通用户仅返回 dispatched 且有权限的项目
 */
export async function listUserAccessibleProjects(
  userId: string,
  platformRole: string,
  params?: PaginationParams
) {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where =
    platformRole === "super_admin"
      ? { status: "active" }
      : {
          status: "active",
          intakeStatus: "dispatched",
          OR: [
            { ownerId: userId },
            { members: { some: { userId, status: "active" } } },
            {
              org: {
                members: {
                  some: { userId, status: "active", role: "org_admin" },
                },
              },
            },
          ],
        };

  const [data, total] = await Promise.all([
    db.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        color: true,
        status: true,
        createdAt: true,
        orgId: true,
        org: { select: { id: true, name: true, code: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true, environments: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.project.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取项目详情
 *
 * @internal 此函数不做用户权限校验，调用方必须先通过
 * requireProjectReadAccess() 或 canViewProject() 确认权限。
 */
export async function getProjectById(projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    include: {
      owner: { select: { id: true, email: true, name: true, avatar: true } },
      org: { select: { id: true, name: true, code: true } },
      _count: { select: { members: true, environments: true, tasks: true } },
    },
  });
}

/** 获取项目成员列表（需先通过项目权限校验） */
export async function listProjectMembers(
  scope: Pick<TenantScope, "projectId">,
  params?: PaginationParams
) {
  const projectId = scope.projectId!;
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where = { projectId, status: "active" };

  const [data, total] = await Promise.all([
    db.projectMember.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true, nickname: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.projectMember.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
