/**
 * Security-1：解析主体有效权限绑定
 *
 * 来源优先级：
 * 1) PrincipalRoleBinding → RolePermissionBinding
 * 2) 兼容回退：OrganizationMember.role → 系统 RoleProfile key（无 DB 绑定时）
 */

import { db } from "@/lib/db";
import { SYSTEM_ROLE_PROFILES } from "./role-defaults";
import type { BindingEffect, DataScope, PrincipalRef } from "./types";

export type EffectiveBinding = {
  permissionKey: string;
  dataScope: DataScope;
  effect: BindingEffect;
  source: string;
};

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
  return null;
}

export async function resolveEffectiveBindings(
  principal: PrincipalRef,
): Promise<EffectiveBinding[]> {
  if (principal.type !== "HUMAN") return [];

  const now = new Date();
  const rows = await db.principalRoleBinding.findMany({
    where: {
      orgId: principal.orgId,
      principalType: "HUMAN",
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

  if (out.length > 0) return out;

  // 兼容回退：按 OrganizationMember.role 映射系统模板（内存，不要求 DB RoleProfile）
  const member = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: principal.orgId, userId: principal.id },
    },
    select: { role: true, status: true },
  });
  if (!member || member.status !== "active") return [];

  const user = await db.user.findUnique({
    where: { id: principal.id },
    select: { role: true },
  });
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
