/**
 * QM Phase 1 — 统一 ScopeContext（薄组合层）
 *
 * 不替代 TenantContext / RBAC / TraceContext，只把服务端已解析的身份与范围
 * 收敛为 Agent / Tool / Memory / PendingAction 共用的不可伪造上下文。
 */

export type ScopeType = "ORG" | "USER" | "PROJECT" | "THREAD";

/**
 * 服务端构造的作用域上下文。
 * 客户端提交的 orgId / userId / role / projectId / scopeId 一律不可信。
 */
export type ScopeContext = {
  orgId: string;
  principalUserId: string;
  /** 组织角色（org_admin / org_member / org_viewer 等），非平台 role */
  principalRole: string;

  scopeType: ScopeType;
  /** ORG→orgId；USER→userId；PROJECT→projectId；THREAD→threadId */
  scopeId: string;

  projectId?: string;
  threadId?: string;
  workspaceId?: string;

  /** 与 TraceContext.traceId 对齐，用于全链串联 */
  correlationId: string;
  causationId?: string;

  hasMembership: boolean;
  isPlatformAdmin: boolean;
  workspaceIds?: string[];

  /**
   * 后台任务 service principal（如 system:cron:project-daily-brief）。
   * 交互请求为空；保留触发来源。
   */
  servicePrincipal?: string;
  triggerSource?: string;
};

/** 客户端可能提交、但必须被忽略的伪称字段 */
export type UntrustedScopeClaim = {
  orgId?: string | null;
  principalUserId?: string | null;
  principalRole?: string | null;
  userId?: string | null;
  role?: string | null;
  projectId?: string | null;
  scopeId?: string | null;
  scopeType?: string | null;
  threadId?: string | null;
  correlationId?: string | null;
};

export type ScopeResolveDeniedReason =
  | "missing_org"
  | "org_not_found"
  | "org_archived"
  | "no_membership"
  | "invalid_project"
  | "project_org_mismatch"
  | "project_access_denied"
  | "invalid_thread"
  | "thread_org_mismatch"
  | "thread_access_denied"
  | "user_scope_mismatch"
  | "ambiguous_scope"
  | "untrusted_claim_rejected"
  | "cross_scope_denied";
