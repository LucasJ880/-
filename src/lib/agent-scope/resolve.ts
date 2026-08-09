/**
 * P0-3 — resolveAgentScope：在现有 tenancy / RBAC 之上组装 AgentScopeContext。
 *
 * 全部输入必须来自服务端（session user + 服务端解析的 activeOrg）。
 * 客户端提交的 orgId / userId / projectId 等只能作为"申请"，在此处 fail-closed 校验。
 */

import { db } from "@/lib/db";
import { createTraceId } from "@/lib/capabilities/trace-context";
import type {
  AgentChannel,
  AgentScopeContext,
  AgentScopeDenyCode,
  ResolveAgentScopeResult,
} from "./types";

export interface ResolveAgentScopeInput {
  /** 服务端 session 解析出的用户（AuthUser 的 id/role） */
  user: { id: string; role: string };
  /** 服务端解析的 active org（resolveAssistantOrgId / requireStreamTenant 结果） */
  orgId: string;
  channel: AgentChannel;
  projectId?: string | null;
  customerId?: string | null;
  workspaceId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  traceId?: string | null;
}

function deny(
  code: AgentScopeDenyCode,
  error: string,
  status = 403,
): ResolveAgentScopeResult {
  return { ok: false, code, error, status };
}

export function normalizeOrgRole(role: string): string {
  if (role === "org_owner") return "org_admin";
  return role;
}

// ── 纯校验函数（可单测，不依赖 DB）─────────────────────────────

export type ScopeEval<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: AgentScopeDenyCode; error: string; status: number };

export function evaluateProjectScope(
  project: {
    orgId: string | null;
    ownerId: string | null;
    isMember: boolean;
  } | null,
  actor: { orgId: string; userId: string },
): ScopeEval<{ projectRole: string }> {
  if (!project) {
    return { ok: false, code: "invalid_project", error: "项目不存在", status: 404 };
  }
  const isPersonalOwn =
    project.orgId === null && project.ownerId === actor.userId;
  if (!isPersonalOwn && project.orgId !== actor.orgId) {
    // 不泄露其他 org 项目的存在性
    return { ok: false, code: "project_org_mismatch", error: "项目不存在", status: 404 };
  }
  if (project.ownerId === actor.userId) return { ok: true, projectRole: "owner" };
  if (project.isMember) return { ok: true, projectRole: "member" };
  if (project.orgId === actor.orgId) return { ok: true, projectRole: "org" };
  return { ok: false, code: "project_access_denied", error: "无权访问该项目", status: 403 };
}

export function evaluateCustomerScope(
  customer: {
    orgId: string;
    createdById: string;
    archived: boolean;
  } | null,
  actor: { orgId: string; userId: string; platformRole: string },
): ScopeEval {
  if (!customer || customer.archived) {
    return { ok: false, code: "invalid_customer", error: "客户不存在", status: 404 };
  }
  if (customer.orgId !== actor.orgId) {
    return { ok: false, code: "customer_org_mismatch", error: "客户不存在", status: 404 };
  }
  // sales own-scope：普通 sales 只能带入自己创建的客户
  if (actor.platformRole === "sales" && customer.createdById !== actor.userId) {
    return { ok: false, code: "customer_access_denied", error: "无权访问该客户", status: 403 };
  }
  return { ok: true };
}

export function evaluateWorkspaceScope(
  workspace: { orgId: string; active: boolean } | null,
  wsMemberRole: string | null,
  actor: { orgId: string; orgRole: string },
): ScopeEval<{ workspaceRole: string }> {
  if (!workspace || !workspace.active) {
    return { ok: false, code: "invalid_workspace", error: "Workspace 不存在", status: 404 };
  }
  if (workspace.orgId !== actor.orgId) {
    return { ok: false, code: "workspace_org_mismatch", error: "Workspace 不存在", status: 404 };
  }
  if (!wsMemberRole && actor.orgRole !== "org_admin") {
    return { ok: false, code: "workspace_access_denied", error: "无权访问该 Workspace", status: 403 };
  }
  return { ok: true, workspaceRole: wsMemberRole ?? "workspace_admin" };
}

export async function resolveAgentScope(
  input: ResolveAgentScopeInput,
): Promise<ResolveAgentScopeResult> {
  const userId = input.user.id;
  const platformRole = input.user.role;
  const isPlatformAdmin =
    platformRole === "admin" || platformRole === "super_admin";

  const orgId = (input.orgId ?? "").trim();
  if (!orgId) {
    return deny("missing_org", "缺少组织上下文", 400);
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, status: true },
  });
  if (!org || org.status === "archived") {
    return deny("org_not_found", "组织不存在或已归档", 404);
  }

  // 平台 admin 不自动绕过企业成员身份（fail-closed）
  const membership = await db.organizationMember.findFirst({
    where: { userId, orgId, status: "active" },
    select: { role: true },
  });
  if (!membership) {
    return deny(
      "no_membership",
      "当前用户不是该组织的活跃成员，AI 执行链拒绝跨组织上下文",
    );
  }
  const orgRole = normalizeOrgRole(membership.role);

  // ── projectId 校验 ──
  let projectId: string | undefined;
  let projectRole: string | undefined;
  if (input.projectId?.trim()) {
    const pid = input.projectId.trim();
    const project = await db.project.findUnique({
      where: { id: pid },
      select: {
        id: true,
        orgId: true,
        ownerId: true,
        members: {
          where: { userId, status: "active" },
          select: { id: true },
          take: 1,
        },
      },
    });
    const evalProject = evaluateProjectScope(
      project
        ? {
            orgId: project.orgId,
            ownerId: project.ownerId,
            isMember: project.members.length > 0,
          }
        : null,
      { orgId, userId },
    );
    if (!evalProject.ok) {
      return deny(evalProject.code, evalProject.error, evalProject.status);
    }
    projectRole = evalProject.projectRole;
    projectId = pid;
  }

  // ── customerId 校验 ──
  let customerId: string | undefined;
  if (input.customerId?.trim()) {
    const cid = input.customerId.trim();
    const customer = await db.salesCustomer.findUnique({
      where: { id: cid },
      select: { id: true, orgId: true, createdById: true, archivedAt: true },
    });
    const evalCustomer = evaluateCustomerScope(
      customer
        ? {
            orgId: customer.orgId,
            createdById: customer.createdById,
            archived: customer.archivedAt !== null,
          }
        : null,
      { orgId, userId, platformRole },
    );
    if (!evalCustomer.ok) {
      return deny(evalCustomer.code, evalCustomer.error, evalCustomer.status);
    }
    customerId = cid;
  }

  // ── workspaceId 校验 ──
  let workspaceId: string | undefined;
  let workspaceRole: string | undefined;
  if (input.workspaceId?.trim()) {
    const wid = input.workspaceId.trim();
    const workspace = await db.workspace.findUnique({
      where: { id: wid },
      select: { id: true, orgId: true, status: true },
    });
    const wsMember = workspace
      ? await db.workspaceMember.findFirst({
          where: { workspaceId: wid, userId, status: "active" },
          select: { role: true },
        })
      : null;
    const evalWs = evaluateWorkspaceScope(
      workspace
        ? { orgId: workspace.orgId, active: workspace.status === "active" }
        : null,
      wsMember?.role ?? null,
      { orgId, orgRole },
    );
    if (!evalWs.ok) {
      return deny(evalWs.code, evalWs.error, evalWs.status);
    }
    workspaceId = wid;
    workspaceRole = evalWs.workspaceRole;
  }

  const scope: AgentScopeContext = {
    principalUserId: userId,
    principalPlatformRole: platformRole,
    orgId,
    orgRole,
    isPlatformAdmin,
    hasMembership: true,
    workspaceId,
    workspaceRole,
    projectId,
    projectRole,
    customerId,
    threadId: input.threadId?.trim() || undefined,
    channel: input.channel as AgentChannel,
    traceId: input.traceId?.trim() || createTraceId(),
    sessionId: input.sessionId?.trim() || undefined,
    agentRunId: input.agentRunId?.trim() || undefined,
  };

  return { ok: true, scope };
}

/** 投影为 ToolExecutionContext.scopeGuard（P0-3 工具参数防覆盖） */
export function toScopeGuard(scope: AgentScopeContext): {
  orgId: string;
  principalUserId: string;
  projectId?: string;
} {
  return {
    orgId: scope.orgId,
    principalUserId: scope.principalUserId,
    projectId: scope.projectId,
  };
}
