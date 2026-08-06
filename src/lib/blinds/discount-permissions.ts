/**
 * 企业报价折扣属于企业经营政策，只允许企业负责人维护。
 * 平台 admin 身份本身不构成业务授权；用户必须在当前企业拥有 org_owner 身份。
 */
export function canManageQuoteDiscountSettings(orgRole: string): boolean {
  return orgRole === "org_owner";
}
