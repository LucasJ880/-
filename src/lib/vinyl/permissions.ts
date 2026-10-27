/**
 * 开启状态编码表直接决定工厂下料的条/盖用量，属于工艺基线，
 * 只允许企业负责人维护（与报价折扣同级别）。
 * 平台 admin 允许操作以便排障，但不构成业务授权的常规路径。
 */
export function canManageVinylPanelCodes(
  orgRole: string,
  isPlatformAdmin = false,
): boolean {
  return orgRole === "org_owner" || isPlatformAdmin;
}
