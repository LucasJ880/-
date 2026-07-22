/**
 * 能力中台读取访问控制
 * - 必须 membership（平台 admin 无 membership → 拒绝）
 * - Workspace 成员关系决定完整 Trace
 * - Org Admin 默认 AGGREGATE_ONLY
 */

import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenancy/context";
import type { CapabilitiesAccessContext, RunVisibilityPolicy } from "./types";
import { runVisibilityFromOrgSettings } from "./visibility";

export class CapabilitiesAccessError extends Error {
  constructor(
    message: string,
    public readonly code: "FORBIDDEN" | "NOT_FOUND" | "NO_MEMBERSHIP",
    public readonly httpStatus: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "CapabilitiesAccessError";
  }
}

export async function buildCapabilitiesAccess(
  tenant: TenantContext,
  opts?: { requireMembership?: boolean },
): Promise<CapabilitiesAccessContext> {
  const requireMembership = opts?.requireMembership !== false;

  if (requireMembership) {
    const member = await db.organizationMember.findUnique({
      where: {
        orgId_userId: { orgId: tenant.orgId, userId: tenant.userId },
      },
      select: { status: true, role: true },
    });
    if (!member || member.status !== "active") {
      throw new CapabilitiesAccessError(
        "无企业成员身份，不能访问企业能力中台",
        "NO_MEMBERSHIP",
        403,
      );
    }
  }

  const org = await db.organization.findUnique({
    where: { id: tenant.orgId },
    select: { settingsJson: true },
  });

  const workspaceIds =
    tenant.workspaceIds ??
    (
      await db.workspaceMember.findMany({
        where: {
          userId: tenant.userId,
          status: "active",
          workspace: { orgId: tenant.orgId, status: "active" },
        },
        select: { workspaceId: true },
      })
    ).map((r) => r.workspaceId);

  return {
    userId: tenant.userId,
    orgId: tenant.orgId,
    orgRole: tenant.orgRole,
    isPlatformAdmin: tenant.isPlatformAdmin,
    workspaceIds,
    runVisibility: runVisibilityFromOrgSettings(org?.settingsJson),
    hasMembership: true,
  };
}

export function assertOrgScope(
  access: CapabilitiesAccessContext,
  orgId: string | null | undefined,
): void {
  if (!orgId || orgId !== access.orgId) {
    throw new CapabilitiesAccessError("资源不属于当前企业", "NOT_FOUND", 404);
  }
}

export function isWorkspaceMember(
  access: CapabilitiesAccessContext,
  workspaceId: string | null | undefined,
): boolean {
  if (!workspaceId) {
    // 无 workspace 归属的运行：org_admin 仍受 visibility；member 可看元数据级
    return false;
  }
  return access.workspaceIds.includes(workspaceId);
}

export function isOrgAdminRole(orgRole: string): boolean {
  return orgRole === "org_admin";
}

export type DetailAccessMode = "full" | "metadata" | "aggregate";

export function resolveDetailAccessMode(
  access: CapabilitiesAccessContext,
  workspaceId: string | null | undefined,
): DetailAccessMode {
  if (isWorkspaceMember(access, workspaceId)) return "full";
  if (isOrgAdminRole(access.orgRole)) {
    if (access.runVisibility === "FULL") return "full";
    if (access.runVisibility === "METADATA_ONLY") return "metadata";
    return "aggregate";
  }
  return "aggregate";
}

export function visibilityForMode(mode: DetailAccessMode): RunVisibilityPolicy {
  if (mode === "full") return "FULL";
  if (mode === "metadata") return "METADATA_ONLY";
  return "AGGREGATE_ONLY";
}
