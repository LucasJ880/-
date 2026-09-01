/**
 * Trusted principal（B.1 §13）：orgId/userId 只能来自服务端认证上下文
 * （requireTenantContext 解析结果），禁止取自客户端 payload。
 * 所有 service 函数以 actor.orgId 作为内部查询条件（org-scoped adjudication，
 * 从查询开始隔离），DB FK 不是授权。
 */
export interface SupplierIntelActor {
  orgId: string;
  userId: string;
}
