/**
 * Security-1：解析主体有效权限绑定
 *
 * 来源优先级：
 * 1) PrincipalRoleBinding → RolePermissionBinding
 * 2) 兼容回退：OrganizationMember.role → 系统 RoleProfile key（无 DB 绑定时；PERM-4c3：只在旧模式企业）
 */

import { db } from "@/lib/db";
import { PERMISSION_REGISTRY } from "./permissions";
import { SYSTEM_ROLE_PROFILES, hasPositionTemplates } from "./role-defaults";
import type { BindingEffect, DataScope, PrincipalRef } from "./types";

export type EffectiveBinding = {
  permissionKey: string;
  dataScope: DataScope;
  effect: BindingEffect;
  source: string;
};

/**
 * PERM-1：平台管理员（User.role = super_admin）在任何企业内全权——
 * Registry 全部权限 × ORG，来源标记 platform_admin（审计可与 binding:* / compat:* 区分）。
 * 平台 admin / boss / manager 不在此列。
 */
export function platformAdminBindings(): EffectiveBinding[] {
  return PERMISSION_REGISTRY.map((p) => ({
    permissionKey: p.key,
    dataScope: "ORG" as DataScope,
    effect: "ALLOW" as BindingEffect,
    source: `platform_admin:${p.key}`,
  }));
}

function membershipRoleToProfileKey(role: string): string | null {
  if (role === "org_owner") return "org_owner";
  if (role === "org_admin") return "org_admin";
  if (role === "org_viewer") return "viewer";
  if (role === "org_member") return null; // 需岗位绑定；默认不加业务权限
  return null;
}

/**
 * 无 PrincipalRoleBinding 时的兼容岗位 key（纯函数，供单测）。
 * trade / manager / user 等不得映射为 sales_rep。
 */
export function compatProfileKeyForMembership(opts: {
  orgRole: string;
  platformRole: string;
}): string | null {
  const fromOrg = membershipRoleToProfileKey(opts.orgRole);
  if (fromOrg) return fromOrg;
  if (opts.orgRole === "org_member" && opts.platformRole === "sales") {
    return "sales_rep";
  }
  // PERM-6a：旧模式企业的平台 trade 成员 → 外贸业务员（岗位模式企业不做兼容回退，见 compatFallbackAllowed）
  if (opts.orgRole === "org_member" && opts.platformRole === "trade") {
    return "trade_rep";
  }
  return null;
}

/**
 * PERM-4c3：岗位模式企业（行业包有岗位模板）只认岗位绑定，不做成员角色兼容回退；旧模式企业（梦馨）照旧。
 */
export function compatFallbackAllowed(industryPackId: string | null | undefined): boolean {
  return !hasPositionTemplates(industryPackId);
}

async function loadProfileBindings(
  principal: PrincipalRef,
): Promise<EffectiveBinding[]> {
  const now = new Date();
  const rows = await db.principalRoleBinding.findMany({
    where: {
      orgId: principal.orgId,
      principalType: principal.type,
      principalId: principal.id,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      roleProfile: {
        include: {
          permissions: true,
        },
      },
    },
  });

  const out: EffectiveBinding[] = [];
  for (const row of rows) {
    if (row.roleProfile.status !== "active") continue;
    for (const p of row.roleProfile.permissions) {
      out.push({
        permissionKey: p.permissionKey,
        dataScope: p.dataScope as DataScope,
        effect: (p.effect === "DENY" ? "DENY" : "ALLOW") as BindingEffect,
        source: `binding:${row.id}:${p.id}`,
      });
    }
  }
  return out;
}

export async function resolveEffectiveBindings(
  principal: PrincipalRef,
): Promise<EffectiveBinding[]> {
  // PERM-5b：数字员工只认自己的岗位绑定——无平台管理员全权、无成员角色兼容回退、不继承 sponsor
  if (principal.type === "DIGITAL_EMPLOYEE") return loadProfileBindings(principal);
  if (principal.type !== "HUMAN") return [];

  const user = await db.user.findUnique({
    where: { id: principal.id },
    select: { role: true },
  });
  if (user?.role === "super_admin") {
    return platformAdminBindings();
  }

  const out = await loadProfileBindings(principal);
  if (out.length > 0) return out;

  // PERM-4c3：岗位模式企业无绑定 = 无权限
  const org = await db.organization.findUnique({
    where: { id: principal.orgId },
    select: { industryPackId: true },
  });
  if (!compatFallbackAllowed(org?.industryPackId)) return [];

  // 兼容回退：按 OrganizationMember.role 映射系统模板（内存，不要求 DB RoleProfile）
  const member = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: principal.orgId, userId: principal.id },
    },
    select: { role: true, status: true },
  });
  if (!member || member.status !== "active") return [];

  const profileKey = compatProfileKeyForMembership({
    orgRole: member.role,
    platformRole: user?.role ?? "",
  });
  if (!profileKey) {
    return [];
  }
  const template = SYSTEM_ROLE_PROFILES.find((p) => p.key === profileKey);
  if (!template) return [];
  return template.bindings.map((b, i) => ({
    permissionKey: b.permissionKey,
    dataScope: b.dataScope,
    effect: (b.effect ?? "ALLOW") as BindingEffect,
    source: `compat:${member.role}:${i}`,
  }));
}

/** 测试 / seed 辅助：直接从系统模板展开 */
export function bindingsFromSystemProfile(
  profileKey: string,
): EffectiveBinding[] {
  const template = SYSTEM_ROLE_PROFILES.find((p) => p.key === profileKey);
  if (!template) return [];
  return template.bindings.map((b, i) => ({
    permissionKey: b.permissionKey,
    dataScope: b.dataScope,
    effect: (b.effect ?? "ALLOW") as BindingEffect,
    source: `system:${profileKey}:${i}`,
  }));
}
