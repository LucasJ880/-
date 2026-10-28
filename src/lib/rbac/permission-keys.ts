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
