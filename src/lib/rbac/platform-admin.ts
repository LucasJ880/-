/**
 * 平台管理员（CTO / 调试面）统一判断。
 *
 * 与组织角色严格区分：
 * - platform admin：User.role 为 admin / super_admin
 * - org_owner / org_admin /「企业负责人」：仅组织业务权限，不自动获得调试面
 *
 * 业务代码与测试应优先使用本模块，避免各处手写 role === "admin"。
 */

import { isSuperAdmin } from "./roles";

/** 平台管理员：admin | super_admin（兼容旧 super_admin） */
export function isPlatformAdmin(
  roleOrUser: string | null | undefined | { role?: string | null },
): boolean {
  const role =
    typeof roleOrUser === "string" || roleOrUser == null
      ? roleOrUser
      : roleOrUser.role;
  return isSuperAdmin(role ?? "");
}

export const PLATFORM_ADMIN_REQUIRED = "PLATFORM_ADMIN_REQUIRED";
export const PLATFORM_ADMIN_ERROR_MESSAGE = "该功能仅供平台管理员使用";
export const PLATFORM_ADMIN_PAGE_DENIED_MESSAGE = "你没有访问此页面的权限";
