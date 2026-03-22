/**
 * 项目可见性统一过滤层
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ⚠️ 开发约束 — 所有项目查询必须经过此模块                  ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  核心规则：                                                  ║
 * ║  1. intakeStatus="pending_dispatch" 仅 super_admin 可见      ║
 * ║  2. intakeStatus="dispatched" 按权限逻辑可见                 ║
 * ║  3. super_admin 可见全部项目                                 ║
 * ║                                                              ║
 * ║  禁止在 API / service 层直接写 db.project.findMany()         ║
 * ║  而不经过以下函数之一：                                      ║
 * ║  - buildProjectVisibilityWhere(user)                         ║
 * ║  - getVisibleProjectIds(userId, role)                        ║
 * ║  - requireProjectReadAccess(request, projectId)              ║
 * ║  - canViewProject(user, project)                             ║
 * ║                                                              ║
 * ║  如需内部系统查询（如 cron / migration），必须标注 @internal ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { AuthUser } from "@/lib/auth";

export type IntakeStatusFilter = "all" | "pending_dispatch" | "dispatched";

/**
 * 构建 Prisma where 子句，确保当前用户只能看到有权限的项目。
 * 返回 null 表示 super_admin 无需过滤。
 */
export async function buildProjectVisibilityWhere(
  user: AuthUser,
  opts?: { intakeStatusFilter?: IntakeStatusFilter }
): Promise<Record<string, unknown> | null> {
  const filter = opts?.intakeStatusFilter ?? "all";

  if (isSuperAdmin(user.role)) {
    if (filter === "pending_dispatch") {
      return { intakeStatus: "pending_dispatch" };
    }
    if (filter === "dispatched") {
      return { intakeStatus: "dispatched" };
    }
    return null;
  }

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const orgIds = memberships.map((m) => m.orgId);

  return {
    intakeStatus: "dispatched",
    OR: [
      { ownerId: user.id, orgId: null },
      ...(orgIds.length ? [{ orgId: { in: orgIds } }] : []),
      { members: { some: { userId: user.id, status: "active" } } },
    ],
  };
}

/**
 * 获取当前用户可见的项目 ID 列表。
 * 返回 null 表示 super_admin 可见全部。
 * 用于 stats/schedule 等需要 ID 列表的场景。
 */
export async function getVisibleProjectIds(
  userId: string,
  role: string
): Promise<string[] | null> {
  if (isSuperAdmin(role)) return null;

  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "active" },
    select: { orgId: true },
  });
  const orgIds = memberships.map((m) => m.orgId);

  const projects = await db.project.findMany({
    where: {
      intakeStatus: "dispatched",
      OR: [
        { ownerId: userId, orgId: null },
        ...(orgIds.length ? [{ orgId: { in: orgIds } }] : []),
        { members: { some: { userId, status: "active" } } },
      ],
    },
    select: { id: true },
  });

  return projects.map((p) => p.id);
}

/**
 * 检查指定用户是否可以查看某个项目（用于单项目鉴权）。
 */
export function canViewProject(
  user: AuthUser,
  project: { intakeStatus: string; ownerId: string; orgId: string | null },
  opts?: { orgRole: string | null; projectRole: string | null }
): boolean {
  if (isSuperAdmin(user.role)) return true;

  if (project.intakeStatus !== "dispatched") return false;

  if (project.ownerId === user.id) return true;
  if (opts?.orgRole) return true;
  if (opts?.projectRole) return true;

  return false;
}
