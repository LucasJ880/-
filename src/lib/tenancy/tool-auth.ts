/**
 * Agent 工具租户授权 — 以 TenantContext.orgRole 为准，禁止仅凭平台 role 放行。
 *
 * canInvokeTool({ tenant, tool, workspaceId, riskLevel })
 */

import type { ToolDefinition, ToolRisk } from "@/lib/agent-core/types";
import type { PlatformRole } from "@/lib/rbac/roles";
import type { OrgRole } from "@/lib/rbac/roles";
import type { OrgModule } from "@/lib/tenancy/modules";
import { isModuleEnabled, parseOrgModulesJson } from "@/lib/tenancy/modules";
import type { TenantContext } from "@/lib/tenancy/context";
import type { AgentToolPolicyOverride } from "@/lib/org-rules/types";

export type ToolAuthDecision =
  | { ok: true; needsApproval: boolean; reason?: string }
  | { ok: false; error: string; code: ToolAuthDenyCode };

export type ToolAuthDenyCode =
  | "no_membership"
  | "org_role_denied"
  | "module_disabled"
  | "tool_disabled"
  | "risk_too_high"
  | "workspace_denied"
  | "viewer_write_denied";

const RISK_ORDER: Record<ToolRisk, number> = {
  l0_read: 0,
  l1_internal_write: 1,
  l2_soft: 2,
  l3_strong: 3,
};

/** 工具域 → 所需企业模块（任一启用即可） */
const DOMAIN_MODULES: Record<string, OrgModule[]> = {
  sales: ["sales"],
  trade: ["trade", "product_content"],
  project: ["projects", "bids"],
  secretary: ["operations", "sales", "trade"],
  knowledge: ["sales", "trade", "operations"],
  cockpit: ["operations", "trade", "sales"],
  system: ["operations"],
};

/** product_content_* 工具额外要求 */
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

/**
 * 平台 allowRoles 标签 → 组织角色是否满足。
 * - admin 标签：仅 org_admin
 * - sales/trade/manager/user：org_admin 或 org_member
 * - "*"：任意有效 org 成员（含 viewer，写操作另限）
 */
function orgRoleSatisfiesAllowTags(
  orgRole: OrgRole,
  allow: readonly PlatformRole[] | "*",
): boolean {
  if (allow === "*") return true;
  if (orgRole === "org_admin") return true;
  if (orgRole === "org_viewer") {
    // viewer 仅当策略不含 admin 独占时，由 risk 再限制
    return allow.some((t) => t !== "admin");
  }
  // org_member
  return allow.some((t) => t !== "admin");
}

export type CanInvokeToolInput = {
  tenant: Pick<
    TenantContext,
    "userId" | "orgId" | "orgRole" | "isPlatformAdmin" | "workspaceIds"
  >;
  /** 是否已确认 OrganizationMember（平台超管无 membership 必须为 false） */
  hasMembership: boolean;
  tool: Pick<ToolDefinition, "name" | "domain" | "risk" | "allowRoles">;
  workspaceId?: string;
  riskLevel?: ToolRisk;
  /** 会话风险上限 */
  maxRisk?: ToolRisk;
  /** 企业启用模块 raw JSON */
  modulesJson?: unknown;
  /** 企业 Agent 工具政策 */
  toolPolicy?: AgentToolPolicyOverride;
  /** 企业是否要求该工具人工审批 */
  forceApproval?: boolean;
};

export function canInvokeTool(input: CanInvokeToolInput): ToolAuthDecision {
  const {
    tenant,
    hasMembership,
    tool,
    workspaceId,
    maxRisk,
    modulesJson,
    toolPolicy,
    forceApproval,
  } = input;

  // 1) 必须是企业成员；平台管理员无 membership 不可调企业业务工具
  if (!hasMembership) {
    return {
      ok: false,
      code: "no_membership",
      error: "无企业成员身份，不能调用企业业务工具（含平台管理员）",
    };
  }

  const orgRole = normalizeOrgRole(tenant.orgRole);
  if (!orgRole) {
    return {
      ok: false,
      code: "org_role_denied",
      error: `无效的组织角色: ${tenant.orgRole}`,
    };
  }

  // 2) 企业是否禁用该工具
  if (toolPolicy?.disabledTools?.includes(tool.name)) {
    return {
      ok: false,
      code: "tool_disabled",
      error: `企业已禁用工具 ${tool.name}`,
    };
  }

  // 3) 模块启用
  const mods = parseOrgModulesJson(modulesJson);
  const required = toolRequiredModules(tool.name, tool.domain);
  if (mods) {
    const enabled = required.some((m) => isModuleEnabled(mods, m));
    if (!enabled) {
      return {
        ok: false,
        code: "module_disabled",
        error: `企业未启用所需模块（需要: ${required.join("|")}）`,
      };
    }
  }

  // 4) Workspace（若指定）
  if (workspaceId) {
    const ids = tenant.workspaceIds;
    if (
      orgRole !== "org_admin" &&
      ids &&
      !ids.includes(workspaceId)
    ) {
      return {
        ok: false,
        code: "workspace_denied",
        error: "无权访问该 Workspace",
      };
    }
  }

  const risk: ToolRisk = input.riskLevel ?? tool.risk ?? "l0_read";

  // 5) viewer 禁止写
  if (orgRole === "org_viewer" && RISK_ORDER[risk] > RISK_ORDER.l0_read) {
    return {
      ok: false,
      code: "viewer_write_denied",
      error: "组织观察者仅可调用只读工具",
    };
  }

  // 6) orgRole vs allowRoles 标签
  const allow = tool.allowRoles ?? (["admin"] as const);
  if (!orgRoleSatisfiesAllowTags(orgRole, allow as readonly PlatformRole[] | "*")) {
    return {
      ok: false,
      code: "org_role_denied",
      error: `当前组织角色（${orgRole}）无权调用工具 ${tool.name}`,
    };
  }

  // 7) 会话 maxRisk
  if (maxRisk && RISK_ORDER[risk] > RISK_ORDER[maxRisk]) {
    return {
      ok: false,
      code: "risk_too_high",
      error: `工具风险 ${risk} 超过会话上限 ${maxRisk}`,
    };
  }

  const needsApproval =
    forceApproval === true ||
    toolPolicy?.forceApprovalTools?.includes(tool.name) === true ||
    risk === "l3_strong";

  return {
    ok: true,
    needsApproval,
    reason: needsApproval ? "高风险或企业政策要求人工审批" : undefined,
  };
}
