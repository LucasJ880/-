/**
 * 青砚平台级企业微信网关
 *
 * 一套企微自建应用 = 青砚统一入口；凭证存在哨兵 orgId 下。
 * 业务组织仍由 WeChatBinding → activeOrgId / 所属组织解析，不绑死某一客户 org。
 */

export const PLATFORM_WECOM_ORG_ID = "__qingyan_platform__";

/** 回调 URL 推荐 query：?org=platform（也可省略 org） */
export const PLATFORM_WECOM_QUERY = "platform";

export function isPlatformWecomOrgKey(
  org: string | null | undefined,
): boolean {
  if (org == null) return true;
  const key = org.trim();
  return key === "" || key === PLATFORM_WECOM_QUERY || key === PLATFORM_WECOM_ORG_ID;
}

/**
 * 解析回调/配置用的「凭证所在 org 键」。
 * - 无 org / platform / 哨兵 → 平台网关
 * - 其它 → 组织级网关（兼容旧回调）
 */
export function resolveWecomCredentialOrgId(
  queryOrg: string | null | undefined,
): string {
  if (isPlatformWecomOrgKey(queryOrg)) return PLATFORM_WECOM_ORG_ID;
  return (queryOrg ?? "").trim();
}
