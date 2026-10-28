import type { AuthUser } from "@/lib/auth";
import { OPS_MANAGE, holdsOpsPermission } from "@/lib/operations/access";

/**
 * 增长中心（企业事实 / 活动 / 指标…）写权限 —— PERM-4b：运营自己维护，持 operations.manage 才能改；
 * 其他成员只读。组织角色（org_member / org_admin）与平台角色（admin / manager）不再带写权；
 * 平台 super_admin 由平台管理员全权覆盖。
 */
export function canEditMarketingBrandProfile(user: AuthUser, orgId: string): Promise<boolean> {
  return holdsOpsPermission(user, orgId, OPS_MANAGE);
}
