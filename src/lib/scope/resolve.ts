/**
 * ScopeContext 服务端 resolver — fail-closed，无默认组织回退。
 *
 * 依赖注入式 DB 访问，便于单元测试；生产路径使用 prisma db。
 */

import { createTraceId } from "@/lib/capabilities/trace-context";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { ScopeResolutionError } from "./errors";
import { auditScopeDenied } from "./audit";
import type {
  ScopeContext,
  ScopeType,
  UntrustedScopeClaim,
} from "./types";

export type ScopePrincipal = {
  id: string;
  /** 平台角色（仅用于 isSuperAdmin 判定） */
  role: string;
};

export type ScopeOrgRow = {
  id: string;
  status: string;
};

export type ScopeMembershipRow = {
  role: string;
  status: string;
};

export type ScopeProjectRow = {
  id: string;
  orgId: string | null;
  ownerId: string | null;
  intakeStatus: string | null;
};

export type ScopeProjectMemberRow = {
  role: string;
  status: string;
};

export type ScopeThreadRow = {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
};

export type ScopeResolveDeps = {
  findOrg: (orgId: string) => Promise<ScopeOrgRow | null>;
  findMembership: (
    userId: string,
    orgId: string,
  ) => Promise<ScopeMembershipRow | null>;
  findProject: (projectId: string) => Promise<ScopeProjectRow | null>;
  findProjectMember: (
    userId: string,
    projectId: string,
  ) => Promise<ScopeProjectMemberRow | null>;
  findThread: (threadId: string) => Promise<ScopeThreadRow | null>;
  loadWorkspaceIds?: (userId: string, orgId: string) => Promise<string[]>;
  /** 测试可关闭审计副作用 */
  audit?: boolean;
};

export type ResolveScopeInput = {
  principal: ScopePrincipal;
  /** 服务端已解析的组织 ID（来自 TenantContext / resolveAgentTenant 等），不得直接用客户端 body */
  orgId: string;
  scopeType: ScopeType;
  /** PROJECT / THREAD 时必填对应 id；USER 时可选（默认 principal.id） */
  scopeId?: string;
  projectId?: string;
  threadId?: string;
  workspaceId?: string;
  correlationId?: string;
  causationId?: string;
  servicePrincipal?: string;
  triggerSource?: string;
  /**
   * 客户端伪称字段：仅用于检测伪造并拒绝，绝不作为真相源。
   */
  untrustedClaim?: UntrustedScopeClaim;
  /**
   * 后台任务：允许无 OrganizationMember（仍须合法 org + servicePrincipal）。
   * 交互请求必须保持 false。
   */
  allowServicePrincipalWithoutMembership?: boolean;
};

function deny(
  reason: ScopeResolutionError["reason"],
  message: string,
  status = 403,
): never {
  throw new ScopeResolutionError(reason, message, status);
}

/**
 * 检测客户端伪称是否试图覆盖服务端身份/组织。
 * 仅在 claim 存在且与已解析真相不一致时拒绝。
 */
export function rejectUntrustedScopeClaims(input: {
  trustedOrgId: string;
  trustedUserId: string;
  claim?: UntrustedScopeClaim;
}): void {
  const c = input.claim;
  if (!c) return;

  const claimedOrg = c.orgId?.trim();
  if (claimedOrg && claimedOrg !== input.trustedOrgId) {
    deny("untrusted_claim_rejected", "拒绝客户端伪造的 orgId", 403);
  }

  const claimedUser = (c.principalUserId ?? c.userId)?.trim();
  if (claimedUser && claimedUser !== input.trustedUserId) {
    deny("untrusted_claim_rejected", "拒绝客户端伪造的 principalUserId", 403);
  }

  // role / scopeId 等伪称一律忽略（不作为真相），不单独因不一致而失败，
  // 避免旧客户端误伤；身份与租户伪造已在上方拦截。
}

async function resolveOrgAndMembership(
  deps: ScopeResolveDeps,
  principal: ScopePrincipal,
  orgId: string,
  opts: {
    allowServicePrincipalWithoutMembership?: boolean;
    servicePrincipal?: string;
  },
): Promise<{
  orgRole: string;
  hasMembership: boolean;
  isPlatformAdmin: boolean;
  workspaceIds: string[];
}> {
  const trimmed = orgId?.trim();
  if (!trimmed) {
    deny("missing_org", "缺少合法 orgId，拒绝执行", 403);
  }

  const org = await deps.findOrg(trimmed);
  if (!org) {
    deny("org_not_found", "组织不存在", 404);
  }
  if (org.status === "archived") {
    deny("org_archived", "组织已归档", 404);
  }

  const membership = await deps.findMembership(principal.id, trimmed);
  const active = membership?.status === "active" ? membership : null;
  const isPlatformAdmin = isSuperAdmin(principal.role);

  if (!active) {
    const serviceOk =
      opts.allowServicePrincipalWithoutMembership === true &&
      !!opts.servicePrincipal?.trim();
    if (!serviceOk && !isPlatformAdmin) {
      deny("no_membership", "无权访问该组织", 403);
    }
    if (!serviceOk && isPlatformAdmin) {
      // 平台超管无 membership：允许解析但标记 hasMembership=false（工具层仍可拒绝写）
    }
  }

  const workspaceIds = deps.loadWorkspaceIds
    ? await deps.loadWorkspaceIds(principal.id, trimmed)
    : [];

  return {
    orgRole: active?.role ?? (opts.servicePrincipal ? "service" : "org_viewer"),
    hasMembership: !!active,
    isPlatformAdmin,
    workspaceIds,
  };
}

async function assertProjectAccess(
  deps: ScopeResolveDeps,
  principal: ScopePrincipal,
  orgId: string,
  projectId: string,
  opts: {
    isPlatformAdmin: boolean;
    /** 明确 service principal：仅校验项目归属组织，不跳过租户 */
    servicePrincipal?: string;
  },
): Promise<ScopeProjectRow> {
  const project = await deps.findProject(projectId);
  if (!project) {
    deny("invalid_project", "项目不存在", 404);
  }
  if (!project.orgId || project.orgId !== orgId) {
    deny("project_org_mismatch", "项目不属于当前组织", 403);
  }

  if (opts.isPlatformAdmin) return project;

  // 后台任务：必须仍校验 org 归属，但可不要求人类成员身份
  if (opts.servicePrincipal?.trim()) return project;

  if (project.ownerId === principal.id) return project;

  const pm = await deps.findProjectMember(principal.id, projectId);
  if (pm?.status === "active") return project;

  // org_admin 可见本组织项目（与 projects/access 对齐的简化版）
  const membership = await deps.findMembership(principal.id, orgId);
  if (membership?.status === "active" && membership.role === "org_admin") {
    return project;
  }

  deny("project_access_denied", "无权访问该项目", 403);
}

async function assertThreadAccess(
  deps: ScopeResolveDeps,
  principal: ScopePrincipal,
  orgId: string,
  threadId: string,
  isPlatformAdmin: boolean,
): Promise<ScopeThreadRow> {
  const thread = await deps.findThread(threadId);
  if (!thread) {
    deny("invalid_thread", "线程不存在", 404);
  }
  if (!thread.orgId || thread.orgId !== orgId) {
    deny("thread_org_mismatch", "线程不属于当前组织", 403);
  }
  if (!isPlatformAdmin && thread.userId !== principal.id) {
    deny("thread_access_denied", "无权访问该线程", 403);
  }
  return thread;
}

/**
 * 构造不可伪造的 ScopeContext。作用域不明确时抛 ScopeResolutionError。
 */
export async function resolveScopeContext(
  deps: ScopeResolveDeps,
  input: ResolveScopeInput,
): Promise<ScopeContext> {
  const correlationId = input.correlationId?.trim() || createTraceId();

  try {
    rejectUntrustedScopeClaims({
      trustedOrgId: input.orgId,
      trustedUserId: input.principal.id,
      claim: input.untrustedClaim,
    });

    const { orgRole, hasMembership, isPlatformAdmin, workspaceIds } =
      await resolveOrgAndMembership(deps, input.principal, input.orgId, {
        allowServicePrincipalWithoutMembership:
          input.allowServicePrincipalWithoutMembership,
        servicePrincipal: input.servicePrincipal,
      });

    let projectId = input.projectId?.trim() || undefined;
    let threadId = input.threadId?.trim() || undefined;
    let scopeId = input.scopeId?.trim() || undefined;

    switch (input.scopeType) {
      case "ORG": {
        scopeId = input.orgId;
        break;
      }
      case "USER": {
        const userScopeId = scopeId || input.principal.id;
        if (userScopeId !== input.principal.id && !isPlatformAdmin) {
          deny("user_scope_mismatch", "USER scope 仅能指向当前主体", 403);
        }
        scopeId = userScopeId;
        break;
      }
      case "PROJECT": {
        const pid = projectId || scopeId;
        if (!pid) {
          deny("invalid_project", "PROJECT scope 必须提供 projectId", 400);
        }
        await assertProjectAccess(deps, input.principal, input.orgId, pid, {
          isPlatformAdmin,
          servicePrincipal: input.servicePrincipal,
        });
        projectId = pid;
        scopeId = pid;
        break;
      }
      case "THREAD": {
        const tid = threadId || scopeId;
        if (!tid) {
          deny("invalid_thread", "THREAD scope 必须提供 threadId", 400);
        }
        const thread = await assertThreadAccess(
          deps,
          input.principal,
          input.orgId,
          tid,
          isPlatformAdmin,
        );
        threadId = tid;
        scopeId = tid;
        if (thread.projectId) {
          projectId = thread.projectId;
          // 线程携带项目时二次校验项目归属
          await assertProjectAccess(
            deps,
            input.principal,
            input.orgId,
            thread.projectId,
            {
              isPlatformAdmin,
              servicePrincipal: input.servicePrincipal,
            },
          );
        }
        break;
      }
      default:
        deny("ambiguous_scope", "未知 scopeType", 400);
    }

    if (!scopeId) {
      deny("ambiguous_scope", "scopeId 无法确定", 400);
    }

    return {
      orgId: input.orgId,
      principalUserId: input.principal.id,
      principalRole: orgRole,
      scopeType: input.scopeType,
      scopeId,
      projectId,
      threadId,
      workspaceId: input.workspaceId,
      correlationId,
      causationId: input.causationId,
      hasMembership,
      isPlatformAdmin,
      workspaceIds,
      servicePrincipal: input.servicePrincipal,
      triggerSource: input.triggerSource,
    };
  } catch (err) {
    if (err instanceof ScopeResolutionError && deps.audit !== false) {
      await auditScopeDenied({
        reason: err.reason,
        orgId: input.orgId,
        userId: input.principal.id,
        projectId: input.projectId,
        correlationId,
        detail: err.message,
      });
    }
    throw err;
  }
}

/** 将 ScopeContext 投影为 ToolExecutionContext 安全字段（不含 args） */
export function scopeToToolContextFields(scope: ScopeContext): {
  userId: string;
  orgId: string;
  orgRole: string;
  hasMembership: boolean;
  role?: string;
  workspaceId?: string;
  workspaceIds?: string[];
  agentRunId?: string;
} {
  return {
    userId: scope.principalUserId,
    orgId: scope.orgId,
    orgRole: scope.principalRole,
    hasMembership: scope.hasMembership,
    workspaceId: scope.workspaceId,
    workspaceIds: scope.workspaceIds,
  };
}
