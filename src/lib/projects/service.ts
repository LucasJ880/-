import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams, TenantScope } from "@/lib/common/types";
import { normalizePagination } from "@/lib/common/validation";

// ============================================================
// Projects 服务层
// ============================================================

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

/** 获取组织下的项目列表（多租户隔离查询） */
export async function listProjectsByOrg(
  scope: Pick<TenantScope, "orgId">,
  params?: PaginationParams & { status?: string; search?: string }
): Promise<PaginatedResult<ProjectListItem>> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where: Record<string, unknown> = { orgId: scope.orgId };
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

/** 获取用户可访问的项目列表（跨组织） */
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

/** 获取项目详情 */
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

/** 获取项目成员列表 */
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
