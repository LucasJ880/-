export type { ConfigScope } from "./scope";
export { CONFIG_SCOPE_PRIORITY } from "./scope";

export type { OrgModule, OrgModulesConfig } from "./modules";
export {
  ORG_MODULES,
  DEFAULT_SUNNY_MODULES,
  DEFAULT_MENGXIN_MODULES,
  NAV_HREF_MODULES,
  parseOrgModulesJson,
  isModuleEnabled,
  navHrefAllowedByModules,
} from "./modules";

export {
  TenantAccessError,
  assertEntityBelongsToOrg,
  entityBelongsToOrg,
} from "./assert";

export type { TenantContext, RequireTenantOptions } from "./context";
export {
  getTenantContext,
  requireTenantContext,
  requireWorkspaceAccess,
  requireProjectAccess,
} from "./context";

export type {
  ToolAuthDecision,
  CanInvokeToolInput,
  AppliedPolicy,
  WorkspaceToolPolicy,
} from "./tool-auth";
export { canInvokeTool } from "./tool-auth";

export type {
  WorkspaceRole,
  WorkspacePermission,
} from "./workspace-rbac";
export {
  WORKSPACE_ROLES,
  normalizeWorkspaceRole,
  effectiveWorkspaceRole,
  workspaceRoleHasPermission,
  canWorkspaceApprove,
  getWorkspaceMembership,
  assertWorkspacePermission,
} from "./workspace-rbac";

export type { AgentTenantResolved } from "./resolve-agent-tenant";
export { resolveAgentTenant } from "./resolve-agent-tenant";

export type { ScopedConfigType, ScopedConfigResult } from "./scoped-config";
export {
  resolveScopedConfig,
  isWorkspaceSkillEnabled,
  LOCKED_SECURITY_KEYS,
} from "./scoped-config";

/** 文件 pathname 是否声明了目标 org（代理层再做 membership） */
export function pathnameDeclaresOrg(
  pathname: string,
  orgId: string,
): boolean {
  const safe = pathname.replace(/^\/+/, "");
  const patterns = [
    `product-content/${orgId}/`,
    `trade-service/${orgId}/`,
    `trade/intelligence/${orgId}/`,
    `visual-builder/${orgId}/`,
    `visualizer/catalog/${orgId}/`,
    `orgs/${orgId}/`,
  ];
  return patterns.some((p) => safe.startsWith(p));
}
