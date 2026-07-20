/**
 * 组织解析与权限（不信任前端 orgId）
 */

import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import { isAdmin, isSuperAdmin } from "@/lib/rbac/roles";

export async function resolveEmployeeAiOrgId(userId: string): Promise<string | null> {
  let orgId = await getUserActiveOrgId(userId);
  if (!orgId) {
    const m = await db.organizationMember.findFirst({
      where: { userId, status: "active" },
      select: { orgId: true },
    });
    orgId = m?.orgId ?? null;
  }
  return orgId;
}

export async function assertOrgMembership(
  userId: string,
  orgId: string,
): Promise<{ orgId: string; memberRole: string | null }> {
  const membership = await db.organizationMember.findFirst({
    where: { userId, orgId, status: "active" },
    select: { role: true },
  });
  if (!membership) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !isSuperAdmin(user.role)) {
      throw new EmployeeAiAccessError("无权访问该组织", 403);
    }
    return { orgId, memberRole: null };
  }
  return { orgId, memberRole: membership.role };
}

/** 部门主管 / org_admin / 平台 admin 可审核与发布 Playbook */
export function canReviewTeamLearning(input: {
  platformRole?: string | null;
  memberRole?: string | null;
}): boolean {
  if (isAdmin(input.platformRole ?? "")) return true;
  if (input.memberRole === "org_admin") return true;
  // manager 视为部门主管
  if (input.platformRole === "manager") return true;
  return false;
}

export class EmployeeAiAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EmployeeAiAccessError";
  }
}

export async function loadOrgCode(orgId: string): Promise<string | null> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { code: true },
  });
  return org?.code ?? null;
}
