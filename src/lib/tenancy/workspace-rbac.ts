/**
 * Phase 3A-3：Workspace RBAC 兼容层
 * - 角色映射集中维护
 * - 后端判断；平台管理员不自动获得 Workspace role
 */

import { db } from "@/lib/db";

export const WORKSPACE_ROLES = [
  "workspace_admin",
  "manager",
  "editor",
  "member",
  "viewer",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type WorkspacePermission =
  | "ws.meta.read"
  | "ws.runs.read_redacted"
  | "ws.runs.read"
  | "ws.agent.invoke_low"
  | "ws.agent.invoke_medium"
  | "ws.knowledge.edit"
  | "ws.config.manage"
  | "ws.members.manage"
  | "ws.approve.medium"
  | "ws.approve.high"
  | "ws.cost.read";

const ROLE_PERMS: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  viewer: ["ws.meta.read", "ws.runs.read_redacted"],
  member: [
    "ws.meta.read",
    "ws.runs.read_redacted",
    "ws.runs.read",
    "ws.agent.invoke_low",
  ],
  editor: [
    "ws.meta.read",
    "ws.runs.read_redacted",
    "ws.runs.read",
    "ws.agent.invoke_low",
    "ws.agent.invoke_medium",
    "ws.knowledge.edit",
  ],
  manager: [
    "ws.meta.read",
    "ws.runs.read_redacted",
    "ws.runs.read",
    "ws.agent.invoke_low",
    "ws.agent.invoke_medium",
    "ws.knowledge.edit",
    "ws.config.manage",
    "ws.approve.medium",
    "ws.approve.high",
    "ws.cost.read",
  ],
  workspace_admin: [
    "ws.meta.read",
    "ws.runs.read_redacted",
    "ws.runs.read",
    "ws.agent.invoke_low",
    "ws.agent.invoke_medium",
    "ws.knowledge.edit",
    "ws.config.manage",
    "ws.members.manage",
    "ws.approve.medium",
    "ws.approve.high",
    "ws.cost.read",
  ],
};

/** 历史角色别名 → 标准角色 */
const ROLE_ALIASES: Record<string, WorkspaceRole> = {
  workspace_admin: "workspace_admin",
  admin: "workspace_admin",
  ws_admin: "workspace_admin",
  owner: "workspace_admin",
  manager: "manager",
  lead: "manager",
  editor: "editor",
  writer: "editor",
  member: "member",
  user: "member",
  viewer: "viewer",
  readonly: "viewer",
  read_only: "viewer",
};

export function normalizeWorkspaceRole(
  raw: string | null | undefined,
): WorkspaceRole | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ROLE_ALIASES[key] ?? null;
}

/** 未识别角色：读操作按 viewer；写/审批拒绝 */
export function effectiveWorkspaceRole(
  raw: string | null | undefined,
): WorkspaceRole {
  return normalizeWorkspaceRole(raw) ?? "viewer";
}

export function workspaceRoleHasPermission(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return ROLE_PERMS[role].includes(permission);
}

export function canWorkspaceApprove(
  role: WorkspaceRole,
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
): boolean {
  if (risk === "CRITICAL") {
    // CRITICAL 不因 workspace_admin 自动免审；仍需企业政策 + 审批流
    return workspaceRoleHasPermission(role, "ws.approve.high");
  }
  if (risk === "HIGH") {
    return workspaceRoleHasPermission(role, "ws.approve.high");
  }
  if (risk === "MEDIUM") {
    return workspaceRoleHasPermission(role, "ws.approve.medium");
  }
  // LOW：manager+ 或 editor 不默认审批高风险；LOW 可由 manager+
  return workspaceRoleHasPermission(role, "ws.approve.medium");
}

export async function getWorkspaceMembership(opts: {
  userId: string;
  workspaceId: string;
  orgId: string;
}): Promise<{ role: WorkspaceRole; status: string } | null> {
  const row = await db.workspaceMember.findFirst({
    where: {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      status: "active",
      workspace: { orgId: opts.orgId, status: "active" },
    },
    select: { role: true, status: true },
  });
  if (!row) return null;
  return { role: effectiveWorkspaceRole(row.role), status: row.status };
}

export async function assertWorkspacePermission(opts: {
  userId: string;
  orgId: string;
  workspaceId: string | null | undefined;
  permission: WorkspacePermission;
  /** Org Admin 无 WS membership 时：仅允许元数据/聚合类权限 */
  orgRole?: string;
}): Promise<
  | { ok: true; role: WorkspaceRole | null }
  | { ok: false; code: "workspace_denied" | "permission_denied"; error: string }
> {
  if (!opts.workspaceId) {
    // 无 WS：仅 org_admin 可做企业级配置类；业务审批仍需明确审批人
    if (opts.orgRole === "org_admin") {
      return { ok: true, role: null };
    }
    return {
      ok: false,
      code: "workspace_denied",
      error: "缺少 Workspace 上下文",
    };
  }

  const m = await getWorkspaceMembership({
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    orgId: opts.orgId,
  });
  if (!m) {
    if (
      opts.orgRole === "org_admin" &&
      (opts.permission === "ws.meta.read" ||
        opts.permission === "ws.runs.read_redacted" ||
        opts.permission === "ws.cost.read")
    ) {
      return { ok: true, role: null };
    }
    return {
      ok: false,
      code: "workspace_denied",
      error: "非该 Workspace 成员",
    };
  }
  if (!workspaceRoleHasPermission(m.role, opts.permission)) {
    return {
      ok: false,
      code: "permission_denied",
      error: `Workspace 角色 ${m.role} 无权限 ${opts.permission}`,
    };
  }
  return { ok: true, role: m.role };
}
