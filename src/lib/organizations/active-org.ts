/**
 * 用户「当前工作组织」服务端读写。
 * 与浏览器 localStorage（qingyan_selected_org_id）双写，保证登出再登入仍沿用。
 */

import { db } from "@/lib/db";
import { getActivePreview, isPreviewReadonly } from "@/lib/preview/server";
import { PREVIEW_ORG_ROLE } from "@/lib/preview/identity";
import { isSuperAdmin } from "@/lib/rbac/roles";

export type ActiveOrgOption = {
  id: string;
  name: string;
  code: string;
  myRole: string | null;
  memberCount: number;
  projectCount: number;
};

/** VIS-1e：预览企业的选项（成员角色 org_member） */
async function previewOrgOptions(orgId: string): Promise<ActiveOrgOption[]> {
  const [org, projectCount] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, include: { _count: { select: { members: true } } } }),
    db.project.count({ where: { orgId, intakeStatus: "dispatched" } }),
  ]);
  if (!org) return [];
  return [{ id: org.id, name: org.name, code: org.code, myRole: PREVIEW_ORG_ROLE, memberCount: org._count.members, projectCount }];
}

/** 供登录/选组织页展示的组织列表（普通用户：所属；super_admin：全部未归档） */
export async function listActiveOrgOptions(
  userId: string,
  userRole: string
): Promise<ActiveOrgOption[]> {
  // VIS-1e：以岗位预览期间可选企业只有预览企业（成员角色 org_member）
  const preview = await getActivePreview(userId);
  if (preview) return previewOrgOptions(preview.orgId);
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
  const preview = await getActivePreview(userId);
  if (preview) return orgId === preview.orgId;
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
  // VIS-1e：以岗位预览期间当前企业即预览企业（库里的 activeOrgId 不变）
  const preview = await getActivePreview(userId);
  if (preview) return preview.orgId;
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
  // VIS-1e：预览期间（含已失效、尚未退出）不写当前企业
  if (await isPreviewReadonly(userId)) return orgId;
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
  // VIS-1e：以岗位预览期间当前企业即预览企业，不写 activeOrgId
  const preview = await getActivePreview(userId);
  if (preview) {
    return { orgId: preview.orgId, organizations: await previewOrgOptions(preview.orgId), needsSelection: false };
  }
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

  // 偏好失效则清空，强制重选（VIS-1e：预览期间不写）
  if (preferred && !(await isPreviewReadonly(userId))) {
    await db.user.update({
      where: { id: userId },
      data: { activeOrgId: null },
    });
  }

  return { orgId: null, organizations, needsSelection: true };
}
