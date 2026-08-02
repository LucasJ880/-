import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { Prisma } from "@prisma/client";

/**
 * 当前用户可见项目的 where 过滤（与 GET /api/projects 口径一致）：
 * - super_admin：全部
 * - 其他：个人项目（owner 且无组织）、所属组织的项目、显式项目成员
 */
export async function visibleProjectsWhere(
  user: AuthUser
): Promise<Prisma.ProjectWhereInput> {
  if (isSuperAdmin(user.role)) return {};

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const orgIds = memberships.map((m) => m.orgId);

  return {
    OR: [
      { ownerId: user.id, orgId: null },
      ...(orgIds.length ? [{ orgId: { in: orgIds } }] : []),
      { members: { some: { userId: user.id, status: "active" } } },
    ],
  };
}
