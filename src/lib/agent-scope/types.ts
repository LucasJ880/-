/**
 * P0-3 — AgentScopeContext（薄的服务端可信作用域层）
 *
 * 不替代 TenantContext / resolveAgentTenant / RBAC / TraceContext，
 * 只把服务端已解析的身份与范围收敛为 AI 执行链（Context / Tool /
 * PendingAction / Memory）共用的不可伪造上下文。
 *
 * 原则：
 * - 前端不得决定 principalUserId / 覆盖 active org
 * - projectId / customerId / workspaceId 必须校验属于当前 org 且当前用户可访问
 * - fail-closed：任何校验不通过即拒绝，不允许 silent fallback 到其他 org
 */

export type AgentChannel =
  | "web_chat"
  | "operator"
  | "assistant_scenario"
  | "runtime_v2"
  | "messaging"
  | "cron"
  | "api";

export interface AgentScopeContext {
  /** 服务端 session 解析出的当前用户，前端不可指定 */
  principalUserId: string;
  /** 平台角色（数据范围遗留用途） */
  principalPlatformRole: string;
  /** 服务端解析的 active org */
  orgId: string;
  /** 组织角色：org_admin | org_member | org_viewer */
  orgRole: string;
  isPlatformAdmin: boolean;
  hasMembership: boolean;

  workspaceId?: string;
  workspaceRole?: string;
  projectId?: string;
  /** owner | member | org（经组织可见） */
  projectRole?: string;
  customerId?: string;
  threadId?: string;

  channel: AgentChannel;
  traceId: string;
  sessionId?: string;
  agentRunId?: string;
}

export type AgentScopeDenyCode =
  | "missing_org"
  | "org_not_found"
  | "no_membership"
  | "invalid_project"
  | "project_org_mismatch"
  | "project_access_denied"
  | "invalid_customer"
  | "customer_org_mismatch"
  | "customer_access_denied"
  | "invalid_workspace"
  | "workspace_org_mismatch"
  | "workspace_access_denied";

export type ResolveAgentScopeResult =
  | { ok: true; scope: AgentScopeContext }
  | { ok: false; code: AgentScopeDenyCode; error: string; status: number };
