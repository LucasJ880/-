/**
 * 用户「当前工作组织」服务端读写。
 * 与浏览器 localStorage（qingyan_selected_org_id）双写，保证登出再登入仍沿用。
 */

import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";

export type ActiveOrgOption = {
  id: string;
  name: string;
  code: string;
  myRole: string | null;
  memberCount: number;
  projectCount: number;
};

/** 供登录/选组织页展示的组织列表（普通用户：所属；super_admin：全部未归档） */
export async function listActiveOrgOptions(
  userId: string,
  userRole: string
): Promise<ActiveOrgOption[]> {
  if (isSuperAdmin(userRole)) {
    const orgs = await db.organization.findMany({
      where: { status: { not: "archived" } },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true } } },
      take: 200,
    });
    const memberships = await db.organizationMember.findMany({
      where: { userId, status: "active" },
      select: { orgId: true, role: true },
    });
    const roleByOrg = new Map(memberships.map((m) => [m.orgId, m.role]));
    const projectCounts = await db.project.groupBy({
      by: ["orgId"],
      where: {
        orgId: { in: orgs.map((o) => o.id) },
        intakeStatus: "dispatched",
      },
      _count: true,
    });
    const projectCountByOrg = new Map(
      projectCounts.map((g) => [g.orgId, g._count])
    );
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      code: o.code,
      myRole: roleByOrg.get(o.id) ?? null,
      memberCount: o._count.members,
      projectCount: projectCountByOrg.get(o.id) ?? 0,
    }));
  }

  const memberships = await db.organizationMember.findMany({
    where: {
      userId,
      status: "active",
      org: { status: { not: "archived" } },
    },
    include: {
      org: { include: { _count: { select: { members: true } } } },
    },
    orderBy: { joinedAt: "desc" },
  });
  const orgIds = memberships.map((m) => m.org.id);
  const projectCounts = orgIds.length
    ? await db.project.groupBy({
        by: ["orgId"],
        where: { orgId: { in: orgIds }, intakeStatus: "dispatched" },
        _count: true,
      })
    : [];
  const projectCountByOrg = new Map(
    projectCounts.map((g) => [g.orgId, g._count])
  );

  return memberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    code: m.org.code,
    myRole: m.role,
    memberCount: m.org._count.members,
    projectCount: projectCountByOrg.get(m.org.id) ?? 0,
  }));
}

export async function canUserUseOrg(
  userId: string,
  userRole: string,
  orgId: string
): Promise<boolean> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, status: true },
  });
  if (!org || org.status === "archived") return false;
  if (isSuperAdmin(userRole)) return true;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { status: true },
  });
  return membership?.status === "active";
}

export async function getUserActiveOrgId(userId: string): Promise<string | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { activeOrgId: true },
  });
  return row?.activeOrgId ?? null;
}

/**
 * 校验并写入 activeOrgId；校验失败返回 null。
 * 若当前偏好已失效（退出组织/归档），会清空服务端字段。
 */
export async function setUserActiveOrgId(
  userId: string,
  userRole: string,
  orgId: string
): Promise<string | null> {
  const ok = await canUserUseOrg(userId, userRole, orgId);
  if (!ok) return null;
  await db.user.update({
    where: { id: userId },
    data: { activeOrgId: orgId },
  });
  return orgId;
}

/** 解析可用的默认组织：服务端偏好 → 唯一所属组织 → null（需用户选择） */
export async function resolvePreferredOrgId(
  userId: string,
  userRole: string
): Promise<{
  orgId: string | null;
  organizations: ActiveOrgOption[];
  needsSelection: boolean;
}> {
  const organizations = await listActiveOrgOptions(userId, userRole);
  if (organizations.length === 0) {
    return { orgId: null, organizations, needsSelection: false };
  }
  if (organizations.length === 1) {
    const only = organizations[0].id;
    const current = await getUserActiveOrgId(userId);
    if (current !== only) {
      await setUserActiveOrgId(userId, userRole, only);
    }
    return { orgId: only, organizations, needsSelection: false };
  }

  const preferred = await getUserActiveOrgId(userId);
  if (preferred && organizations.some((o) => o.id === preferred)) {
    return { orgId: preferred, organizations, needsSelection: false };
  }

  // 偏好失效则清空，强制重选
  if (preferred) {
    await db.user.update({
      where: { id: userId },
      data: { activeOrgId: null },
    });
  }

  return { orgId: null, organizations, needsSelection: true };
}
