/**
 * Agent / 工具执行前解析租户上下文（必须有 membership）
 */

import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { loadAgentToolPolicyRule } from "@/lib/org-rules/service";
import type { AgentToolPolicyOverride } from "@/lib/org-rules/types";

export type AgentTenantUser = {
  id: string;
  role: string;
};

export type AgentTenantResolved = {
  orgId: string;
  orgRole: string;
  hasMembership: boolean;
  isPlatformAdmin: boolean;
  modulesJson: unknown;
  industryPackId: string | null;
  workspaceIds: string[];
  toolPolicy: AgentToolPolicyOverride;
};

/**
 * 解析 Agent 执行所需的租户字段。
 * 平台超管若无 OrganizationMember，hasMembership=false（工具层将拒绝）。
 */
export async function resolveAgentTenant(
  user: AgentTenantUser,
  orgId: string,
): Promise<AgentTenantResolved | { error: string; status: number }> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      modulesJson: true,
      industryPackId: true,
    },
  });
  if (!org || org.status === "archived") {
    return { error: "组织不存在或已归档", status: 404 };
  }

  const membership = await getOrgMembership(user.id, orgId);
  const active = membership?.status === "active" ? membership : null;
  const isPlatformAdmin = isSuperAdmin(user.role);

  let workspaceIds: string[] = [];
  try {
    const rows = await db.workspaceMember.findMany({
      where: {
        userId: user.id,
        status: "active",
        workspace: { orgId, status: "active" },
      },
      select: { workspaceId: true },
    });
    workspaceIds = rows.map((r) => r.workspaceId);
  } catch {
    workspaceIds = [];
  }

  const policyLoad = await loadAgentToolPolicyRule(orgId);

  return {
    orgId,
    orgRole: active?.role ?? "org_viewer",
    hasMembership: !!active,
    isPlatformAdmin,
    modulesJson: org.modulesJson,
    industryPackId: org.industryPackId,
    workspaceIds,
    toolPolicy: policyLoad.value,
  };
}
