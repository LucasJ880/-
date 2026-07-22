/**
 * Agent 工具租户授权 — 以 TenantContext.orgRole 为准，禁止仅凭平台 role 放行。
 * Phase 3A-3：接入 workspaceRole；返回 allowed / requiresApproval / appliedPolicies
 */

import type { ToolDefinition, ToolRisk } from "@/lib/agent-core/types";
import type { PlatformRole } from "@/lib/rbac/roles";
import type { OrgRole } from "@/lib/rbac/roles";
import type { OrgModule } from "@/lib/tenancy/modules";
import { isModuleEnabled, parseOrgModulesJson } from "@/lib/tenancy/modules";
import type { TenantContext } from "@/lib/tenancy/context";
import type { AgentToolPolicyOverride } from "@/lib/org-rules/types";
import {
  effectiveWorkspaceRole,
  type WorkspaceRole,
  workspaceRoleHasPermission,
} from "@/lib/tenancy/workspace-rbac";

export type ToolAuthDenyCode =
  | "no_membership"
  | "org_role_denied"
  | "module_disabled"
  | "tool_disabled"
  | "risk_too_high"
  | "workspace_denied"
  | "viewer_write_denied"
  | "workspace_role_denied";

export type AppliedPolicy = {
  scope: "PLATFORM" | "ORGANIZATION" | "WORKSPACE";
  policyId?: string;
  version?: number;
};

export type ToolAuthDecision =
  | {
      ok: true;
      allowed: true;
      needsApproval: boolean;
      requiresApproval: boolean;
      reason?: string;
      reasonCode?: string;
      appliedPolicies: AppliedPolicy[];
    }
  | {
      ok: false;
      allowed: false;
      requiresApproval: false;
      needsApproval: false;
      error: string;
      code: ToolAuthDenyCode;
      reasonCode: ToolAuthDenyCode;
      appliedPolicies: AppliedPolicy[];
    };

const RISK_ORDER: Record<ToolRisk, number> = {
  l0_read: 0,
  l1_internal_write: 1,
  l2_soft: 2,
  l3_strong: 3,
};

const DOMAIN_MODULES: Record<string, OrgModule[]> = {
  sales: ["sales"],
  trade: ["trade", "product_content"],
  project: ["projects", "bids"],
  secretary: ["operations", "sales", "trade"],
  knowledge: ["sales", "trade", "operations"],
  cockpit: ["operations", "trade", "sales"],
  system: ["operations"],
};

function toolRequiredModules(toolName: string, domain: string): OrgModule[] {
  if (toolName.startsWith("product_content_")) {
    return ["product_content", "trade"];
  }
  return DOMAIN_MODULES[domain] ?? ["operations"];
}

function normalizeOrgRole(role: string | undefined | null): OrgRole | null {
  if (role === "org_admin" || role === "org_member" || role === "org_viewer") {
    return role;
  }
  return null;
}

function orgRoleSatisfiesAllowTags(
  orgRole: OrgRole,
  allow: readonly PlatformRole[] | "*",
): boolean {
  if (allow === "*") return true;
  if (orgRole === "org_admin") return true;
  if (orgRole === "org_viewer") {
    return allow.some((t) => t !== "admin");
  }
  return allow.some((t) => t !== "admin");
}

export type WorkspaceToolPolicy = {
  disabledTools?: string[];
  /** Workspace 可提高限制的最高风险（收紧）；不可放宽 Org hard */
  maxRisk?: ToolRisk;
  forceApprovalTools?: string[];
  policyId?: string;
  version?: number;
};

export type CanInvokeToolInput = {
  tenant: Pick<
    TenantContext,
    "userId" | "orgId" | "orgRole" | "isPlatformAdmin" | "workspaceIds"
  >;
  hasMembership: boolean;
  tool: Pick<ToolDefinition, "name" | "domain" | "risk" | "allowRoles">;
  workspaceId?: string;
  /** Phase 3A-3：Workspace 角色（不可信前端；应由后端解析后传入） */
  workspaceRole?: string | null;
  riskLevel?: ToolRisk;
  maxRisk?: ToolRisk;
  modulesJson?: unknown;
  toolPolicy?: AgentToolPolicyOverride;
  workspaceToolPolicy?: WorkspaceToolPolicy;
  forceApproval?: boolean;
};

function deny(
  code: ToolAuthDenyCode,
  error: string,
  appliedPolicies: AppliedPolicy[],
): ToolAuthDecision {
  return {
    ok: false,
    allowed: false,
    requiresApproval: false,
    needsApproval: false,
    error,
    code,
    reasonCode: code,
    appliedPolicies,
  };
}

export function canInvokeTool(input: CanInvokeToolInput): ToolAuthDecision {
  const {
    tenant,
    hasMembership,
    tool,
    workspaceId,
    maxRisk,
    modulesJson,
    toolPolicy,
    workspaceToolPolicy,
    forceApproval,
  } = input;

  const appliedPolicies: AppliedPolicy[] = [
    { scope: "PLATFORM", policyId: "tool-auth-default", version: 1 },
  ];

  if (!hasMembership) {
    return deny(
      "no_membership",
      "无企业成员身份，不能调用企业业务工具（含平台管理员）",
      appliedPolicies,
    );
  }

  const orgRole = normalizeOrgRole(tenant.orgRole);
  if (!orgRole) {
    return deny(
      "org_role_denied",
      `无效的组织角色: ${tenant.orgRole}`,
      appliedPolicies,
    );
  }

  if (toolPolicy?.disabledTools?.includes(tool.name)) {
    appliedPolicies.push({
      scope: "ORGANIZATION",
      policyId: "org-tool-disabled",
      version: 1,
    });
    return deny("tool_disabled", `企业已禁用工具 ${tool.name}`, appliedPolicies);
  }

  if (workspaceToolPolicy?.disabledTools?.includes(tool.name)) {
    appliedPolicies.push({
      scope: "WORKSPACE",
      policyId: workspaceToolPolicy.policyId ?? "ws-tool-disabled",
      version: workspaceToolPolicy.version,
    });
    return deny(
      "tool_disabled",
      `Workspace 已禁用工具 ${tool.name}`,
      appliedPolicies,
    );
  }

  const mods = parseOrgModulesJson(modulesJson);
  const required = toolRequiredModules(tool.name, tool.domain);
  if (mods) {
    const enabled = required.some((m) => isModuleEnabled(mods, m));
    if (!enabled) {
      return deny(
        "module_disabled",
        `企业未启用所需模块（需要: ${required.join("|")}）`,
        appliedPolicies,
      );
    }
  }

  if (workspaceId) {
    const ids = tenant.workspaceIds;
    if (orgRole !== "org_admin" && ids && !ids.includes(workspaceId)) {
      return deny("workspace_denied", "无权访问该 Workspace", appliedPolicies);
    }
  }

  const risk: ToolRisk = input.riskLevel ?? tool.risk ?? "l0_read";
  const wsRole: WorkspaceRole | null = input.workspaceRole
    ? effectiveWorkspaceRole(input.workspaceRole)
    : null;

  // Workspace 角色：viewer 禁止写；member 仅低风险
  if (wsRole) {
    appliedPolicies.push({
      scope: "WORKSPACE",
      policyId: `ws-role:${wsRole}`,
      version: 1,
    });
    if (
      wsRole === "viewer" &&
      RISK_ORDER[risk] > RISK_ORDER.l0_read
    ) {
      return deny(
        "workspace_role_denied",
        "Workspace viewer 不可执行写操作",
        appliedPolicies,
      );
    }
    if (
      wsRole === "member" &&
      RISK_ORDER[risk] > RISK_ORDER.l1_internal_write &&
      !workspaceRoleHasPermission(wsRole, "ws.agent.invoke_medium")
    ) {
      return deny(
        "workspace_role_denied",
        "Workspace member 不可调用中高风险工具",
        appliedPolicies,
      );
    }
  }

  if (orgRole === "org_viewer" && RISK_ORDER[risk] > RISK_ORDER.l0_read) {
    return deny(
      "viewer_write_denied",
      "组织观察者仅可调用只读工具",
      appliedPolicies,
    );
  }

  const allow = tool.allowRoles ?? (["admin"] as const);
  if (!orgRoleSatisfiesAllowTags(orgRole, allow as readonly PlatformRole[] | "*")) {
    return deny(
      "org_role_denied",
      `当前组织角色（${orgRole}）无权调用工具 ${tool.name}`,
      appliedPolicies,
    );
  }

  // 会话 maxRisk + Workspace 收紧（取更严者）；Workspace 不可放宽 Org
  let effectiveMax = maxRisk;
  if (workspaceToolPolicy?.maxRisk) {
    if (
      !effectiveMax ||
      RISK_ORDER[workspaceToolPolicy.maxRisk] < RISK_ORDER[effectiveMax]
    ) {
      effectiveMax = workspaceToolPolicy.maxRisk;
    }
    appliedPolicies.push({
      scope: "WORKSPACE",
      policyId: workspaceToolPolicy.policyId ?? "ws-max-risk",
      version: workspaceToolPolicy.version,
    });
  }
  if (effectiveMax && RISK_ORDER[risk] > RISK_ORDER[effectiveMax]) {
    return deny(
      "risk_too_high",
      `工具风险 ${risk} 超过上限 ${effectiveMax}`,
      appliedPolicies,
    );
  }

  if (toolPolicy) {
    appliedPolicies.push({
      scope: "ORGANIZATION",
      policyId: "org-tool-policy",
      version: 1,
    });
  }

  const requiresApproval =
    forceApproval === true ||
    toolPolicy?.forceApprovalTools?.includes(tool.name) === true ||
    workspaceToolPolicy?.forceApprovalTools?.includes(tool.name) === true ||
    risk === "l3_strong";

  // CRITICAL / l3_strong：workspace_admin 不得免审批
  return {
    ok: true,
    allowed: true,
    needsApproval: requiresApproval,
    requiresApproval,
    reason: requiresApproval ? "高风险或企业政策要求人工审批" : undefined,
    reasonCode: requiresApproval ? "requires_approval" : undefined,
    appliedPolicies,
  };
}
