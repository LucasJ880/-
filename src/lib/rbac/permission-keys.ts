/**
 * 用户在企业内的 ALLOW 权限键（去重）——工作区策略按岗位放行时用。
 * 页面侧经 resolveWorkspaceContextFromCookies 注入；API 侧（/api/ops/*）直接调用（PERM-4b）。
 * 解析失败返回 null（调用方按"无权限键"处理）。
 */

import { resolveEffectiveBindings } from "@/lib/authorization/resolve-effective-permissions";

export async function loadPermissionKeys(userId: string, orgId: string): Promise<string[] | null> {
  try {
    const bindings = await resolveEffectiveBindings({ type: "HUMAN", id: userId, orgId });
    return [...new Set(bindings.filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey))];
  } catch {
    return null;
  }
}

/**
 * PERM-4c2：岗位模式——企业行业包有岗位模板时，导航 / 默认落地 / 管理层按岗位权限键（窗饰）；
 * 否则沿用平台角色旧规则（梦馨）。查询失败按旧模式（不改变现有行为）。
 */
export async function loadPositionMode(orgId: string): Promise<boolean> {
  try {
    const { db } = await import("@/lib/db");
    const { hasPositionTemplates } = await import("@/lib/authorization/role-defaults");
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { industryPackId: true } });
    return hasPositionTemplates(org?.industryPackId);
  } catch {
    return false;
  }
}
