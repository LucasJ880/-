/**
 * B1（QYANE_RUNTIME_CONVERGENCE_T3_5 安全线）— 权威租户字段 → runAgent 选项。
 *
 * 安全不变量（见 docs/QINGYAN_RUNTIME_CONVERGENCE_T3_5_R1_DEVELOPMENT_RULES.md）：
 *   effectiveScope ⊆ authenticatedAuthorizedScope
 * 工具执行的租户身份只能来自服务端 resolveAgentTenant（DB 权威解析），
 * 绝不来自模型/工具参数，也绝不允许字面量硬编码（hasMembership: true 等
 * 由 mention-gateway m1-static-policy 与 B1 静态测试双重禁止）。
 *
 * 本模块是纯映射：不查库、不放宽任何字段——
 * resolveAgentTenant 说没有 membership，这里就原样传 false（fail-closed，
 * 工具层 canInvokeTool 将拒绝企业业务工具）。
 */

import type { AgentTenantResolved } from "./resolve-agent-tenant";

export interface AgentTenantRunFields {
  orgRole: string;
  hasMembership: boolean;
  modulesJson: unknown;
  workspaceIds: string[];
  toolPolicy: AgentTenantResolved["toolPolicy"];
}

/**
 * 把 resolveAgentTenant 的权威结果映射为 runAgent / runAgentStream 需要的
 * 租户授权字段。纯函数；永不提升权限（无默认放行、无字段伪造）。
 */
export function toAgentTenantRunFields(
  tenant: AgentTenantResolved,
): AgentTenantRunFields {
  return {
    orgRole: tenant.orgRole,
    hasMembership: tenant.hasMembership,
    modulesJson: tenant.modulesJson,
    workspaceIds: tenant.workspaceIds,
    toolPolicy: tenant.toolPolicy,
  };
}
