import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams, TenantScope } from "@/lib/common/types";
import { normalizePagination } from "@/lib/common/validation";
import { DEFAULT_ENVIRONMENTS } from "@/lib/common/constants";
import { slugifyOrgCode, ensureUniqueOrgCode } from "./utils";

// ============================================================
// Organizations 服务层
// ============================================================

export interface CreateOrgInput {
  name: string;
  code?: string;
  ownerId: string;
  planType?: string;
}

export interface OrgListItem {
  id: string;
  name: string;
  code: string;
  status: string;
  planType: string;
  createdAt: Date;
  _count: { members: number; projects: number };
}

/** 创建组织 + owner 成为 org_admin */
export async function createOrganization(input: CreateOrgInput) {
  const baseCode = input.code || slugifyOrgCode(input.name);
  const code = await ensureUniqueOrgCode(baseCode);

  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        code,
        ownerId: input.ownerId,
        planType: input.planType ?? "free",
      },
    });

    await tx.organizationMember.create({
      data: {
        orgId: org.id,
        userId: input.ownerId,
        role: "org_admin",
        status: "active",
      },
    });

    return org;
  });
}

/** 获取用户所属的组织列表 */
export async function listUserOrganizations(
  userId: string,
  params?: PaginationParams
): Promise<PaginatedResult<OrgListItem>> {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where = {
    members: { some: { userId, status: "active" } },
    status: "active",
  };

  const [data, total] = await Promise.all([
    db.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        planType: true,
        createdAt: true,
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.organization.count({ where }),
  ]);

  return {
    data: data as OrgListItem[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** 获取组织详情 */
export async function getOrganizationById(orgId: string) {
  return db.organization.findUnique({
    where: { id: orgId },
    include: {
      owner: { select: { id: true, email: true, name: true, avatar: true } },
      _count: { select: { members: true, projects: true } },
    },
  });
}

/** 获取组织成员列表 */
export async function listOrgMembers(
  scope: Pick<TenantScope, "orgId">,
  params?: PaginationParams
) {
  const { page, pageSize, skip } = normalizePagination(params?.page, params?.pageSize);

  const where = { orgId: scope.orgId, status: "active" };

  const [data, total] = await Promise.all([
    db.organizationMember.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true, nickname: true, avatar: true } },
      },
      orderBy: { joinedAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.organizationMember.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** 为组织创建项目（含默认环境） */
export async function createProjectInOrg(input: {
  orgId: string;
  name: string;
  code?: string;
  description?: string;
  ownerId: string;
}) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        code: input.code,
        description: input.description,
        ownerId: input.ownerId,
      },
    });

    await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId: input.ownerId,
        role: "project_admin",
        status: "active",
      },
    });

    for (const env of DEFAULT_ENVIRONMENTS) {
      await tx.environment.create({
        data: {
          projectId: project.id,
          name: env.name,
          code: env.code,
        },
      });
    }

    return project;
  });
}
