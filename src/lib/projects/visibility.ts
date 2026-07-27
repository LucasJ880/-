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
 * ║  - getVisibleProjectIds(userId, role)  — RBAC，含历史项目    ║
 * ║  - getActionableProjectIds(userId, role) — Active View       ║
 * ║  - requireProjectReadAccess(request, projectId)              ║
 * ║  - canViewProject(user, project)                             ║
 * ║                                                              ║
 * ║  如需内部系统查询（如 cron / migration），必须标注 @internal ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { AuthUser } from "@/lib/auth";
import { buildProjectLifecycleWhere } from "@/lib/projects/lifecycle";

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
 * 获取当前用户可见的项目 ID 列表（仅 RBAC / intake，不含生命周期）。
 * 返回 null 表示 super_admin 可见全部。
 * 用于历史报表、详情访问等仍需覆盖已完成/已放弃项目的场景。
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
 * Active View 项目 ID：用户可见 ∩ status=active ∩ abandonedAt=null。
 * 始终返回具体 ID 列表（super_admin 亦然）；空数组表示当前无可行动项目。
 * 供 /api/stats、/api/reminders、/api/schedule、Workbench 使用。
 */
export async function getActionableProjectIds(
  userId: string,
  role: string
): Promise<string[]> {
  const lifecycle = buildProjectLifecycleWhere("active");

  if (isSuperAdmin(role)) {
    const projects = await db.project.findMany({
      where: lifecycle,
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  const visible = await getVisibleProjectIds(userId, role);
  if (!visible || visible.length === 0) return [];

  const projects = await db.project.findMany({
    where: { id: { in: visible }, ...lifecycle },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

/**
 * Active View 任务范围：行动项目内任务 + 用户个人无项目任务。
 * 已完成/放弃项目下的任务不进入首页提醒与日程行动面。
 */
export function buildActionableTaskScope(
  userId: string,
  actionableProjectIds: string[]
): Record<string, unknown> {
  return {
    OR: [
      { projectId: { in: actionableProjectIds } },
      {
        projectId: null,
        OR: [{ creatorId: userId }, { assigneeId: userId }],
      },
    ],
  };
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
