/**
 * 租户归属断言（服务层可复用）
 */

export class TenantAccessError extends Error {
  readonly status: number;
  constructor(message = "无权访问该资源", status = 404) {
    super(message);
    this.name = "TenantAccessError";
    this.status = status;
  }
}

/** 实体 orgId 必须与当前租户一致；不匹配抛 404（避免枚举） */
export function assertEntityBelongsToOrg(
  entityOrgId: string | null | undefined,
  tenantOrgId: string,
  message = "资源不存在",
): asserts entityOrgId is string {
  if (!entityOrgId || entityOrgId !== tenantOrgId) {
    throw new TenantAccessError(message, 404);
  }
}

export function entityBelongsToOrg(
  entityOrgId: string | null | undefined,
  tenantOrgId: string,
): boolean {
  return Boolean(entityOrgId && entityOrgId === tenantOrgId);
}
