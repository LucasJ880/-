/**
 * PERM-2：按岗位权限找审批人 + 批准人资格校验
 *
 * 持有某权限键的人 = PrincipalRoleBinding(active, HUMAN) → RoleProfile(active) → RolePermissionBinding(key, ALLOW)。
 * 空集时回退到企业 ownerId + org_admin（兼容尚未跑岗位绑定的企业）。
 */

import { db } from "@/lib/db";

export async function listUsersWithPermission(orgId: string, permissionKey: string): Promise<string[]> {
  const now = new Date();
  const rows = await db.principalRoleBinding.findMany({
    where: {
      orgId,
      principalType: "HUMAN",
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      roleProfile: {
        status: "active",
        permissions: { some: { permissionKey, effect: "ALLOW" } },
      },
    },
    select: { principalId: true },
  });
  return [...new Set(rows.map((r) => r.principalId))];
}

/** 企业内是否已有人持该权限（决定执行器是否启用岗位强校验） */
export async function hasPermissionHoldersInOrg(orgId: string, permissionKey: string): Promise<boolean> {
  const holders = await listUsersWithPermission(orgId, permissionKey);
  return holders.length > 0;
}

/** 回退收件人：企业 ownerId + active org_admin */
export async function legacyApprovalFallback(orgId: string): Promise<string[]> {
  const [organization, admins] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } }),
    db.organizationMember.findMany({
      where: { orgId, role: "org_admin", status: "active" },
      select: { userId: true },
    }),
  ]);
  return [...new Set([...(organization?.ownerId ? [organization.ownerId] : []), ...admins.map((a) => a.userId)])];
}

/** 纯函数：持有者优先、排除提交人、空集回退（回退集也排除提交人） */
export function pickApprovalRecipients(input: {
  holders: readonly string[];
  fallback: readonly string[];
  requesterId: string;
}): string[] {
  const dedupe = (xs: readonly string[]) => [...new Set(xs)].filter((id) => id && id !== input.requesterId);
  const primary = dedupe(input.holders);
  if (primary.length > 0) return primary;
  return dedupe(input.fallback);
}

export type ApproverCheck = { ok: true; selfApproved: boolean } | { ok: false; reason: string };

/**
 * 纯函数：批准人资格
 * - 提交人自批：拒绝（super_admin 例外，标 selfApproved）
 * - enforcement=true 时无权限拒绝（super_admin 例外）
 * - enforcement=false（企业尚无人持该权限的过渡态）只拒自批
 */
export function checkApproverEligibility(input: {
  approverId: string;
  requesterId: string | null | undefined;
  isPlatformSuperAdmin: boolean;
  hasPermission: boolean;
  enforcement: boolean;
}): ApproverCheck {
  const isSelf = !!input.requesterId && input.requesterId === input.approverId;
  if (input.isPlatformSuperAdmin) {
    return { ok: true, selfApproved: isSelf };
  }
  if (isSelf) {
    return { ok: false, reason: "不能批准自己提交的审批，请由另一位持审批权的人处理" };
  }
  if (input.enforcement && !input.hasPermission) {
    return { ok: false, reason: "无审批权限：需要持有相应岗位（老板）才能批准" };
  }
  return { ok: true, selfApproved: false };
}
