/**
 * 治理中心权限：Org Admin / Workspace Admin；平台 admin 无 membership 不可进
 */

import { CapabilitiesAccessError, isOrgAdminRole } from "../access";
import type { CapabilitiesAccessContext } from "../types";
import {
  effectiveWorkspaceRole,
  getWorkspaceMembership,
  type WorkspaceRole,
} from "@/lib/tenancy/workspace-rbac";

export type GovernanceWriteScope = "organization" | "workspace";

export function assertGovernanceMembership(
  access: CapabilitiesAccessContext,
): void {
  if (!access.hasMembership) {
    throw new CapabilitiesAccessError(
      "无企业成员身份，不能访问治理中心",
      "NO_MEMBERSHIP",
      403,
    );
  }
}

/** 可读治理概览：org_admin 或任一 WS 的 manager+ */
export async function canReadGovernance(
  access: CapabilitiesAccessContext,
): Promise<boolean> {
  assertGovernanceMembership(access);
  if (isOrgAdminRole(access.orgRole)) return true;
  for (const wsId of access.workspaceIds) {
    const m = await getWorkspaceMembership({
      userId: access.userId,
      workspaceId: wsId,
      orgId: access.orgId,
    });
    if (!m) continue;
    const role = effectiveWorkspaceRole(m.role);
    if (
      role === "workspace_admin" ||
      role === "manager" ||
      role === "editor"
    ) {
      return true;
    }
  }
  // member/viewer：仅可看本 WS 用量级只读（仍允许进入 overview 受限视图）
  return access.workspaceIds.length > 0;
}

export async function assertCanReadGovernance(
  access: CapabilitiesAccessContext,
): Promise<void> {
  const ok = await canReadGovernance(access);
  if (!ok) {
    throw new CapabilitiesAccessError("无权访问治理中心", "FORBIDDEN", 403);
  }
}

export async function resolveWorkspaceRole(
  access: CapabilitiesAccessContext,
  workspaceId: string | null | undefined,
): Promise<WorkspaceRole | null> {
  if (!workspaceId) return null;
  const m = await getWorkspaceMembership({
    userId: access.userId,
    workspaceId,
    orgId: access.orgId,
  });
  return m ? effectiveWorkspaceRole(m.role) : null;
}

/** 写企业级配额：仅 org_admin */
export function assertCanWriteOrgQuota(access: CapabilitiesAccessContext): void {
  assertGovernanceMembership(access);
  if (!isOrgAdminRole(access.orgRole)) {
    throw new CapabilitiesAccessError(
      "仅 Organization Admin 可管理企业配额",
      "FORBIDDEN",
      403,
    );
  }
}

/** 写 Workspace 配额：workspace_admin，且只能收紧 */
export async function assertCanWriteWorkspaceQuota(
  access: CapabilitiesAccessContext,
  workspaceId: string,
): Promise<void> {
  assertGovernanceMembership(access);
  if (isOrgAdminRole(access.orgRole)) return;
  const role = await resolveWorkspaceRole(access, workspaceId);
  if (role !== "workspace_admin") {
    throw new CapabilitiesAccessError(
      "仅 Workspace Admin 可管理本 Workspace 配额",
      "FORBIDDEN",
      403,
    );
  }
}

/** 企业级审计：org_admin；否则仅本 WS */
export function auditWorkspaceRestriction(
  access: CapabilitiesAccessContext,
): string[] | null {
  if (isOrgAdminRole(access.orgRole)) return null;
  return access.workspaceIds;
}
