export type {
  ScopeType,
  ScopeContext,
  UntrustedScopeClaim,
  ScopeResolveDeniedReason,
} from "./types";
export { ScopeResolutionError, isScopeResolutionError } from "./errors";
export {
  resolveScopeContext,
  rejectUntrustedScopeClaims,
  scopeToToolContextFields,
  type ScopePrincipal,
  type ScopeResolveDeps,
  type ResolveScopeInput,
} from "./resolve";
export { createPrismaScopeDeps } from "./deps";
export {
  assertSameOrg,
  assertSameProject,
  assertToolArgsDoNotOverrideScope,
} from "./assert";
export {
  isQmScopePhase1Enabled,
  isQmPhase1ShadowMode,
  getQmPhase1OrgAllowlist,
  getQmPhase1ProjectAllowlist,
  isOrgAllowlisted,
  isProjectAllowlisted,
  describeQmPhase1Flags,
} from "./flags";
export {
  readAgentAutomationEnabled,
  isAgentAutomationKilled,
} from "./kill-switch";
export {
  writeQmAuditEvent,
  auditScopeDenied,
  scopeContextAuditSlice,
  type QmAuditEvent,
} from "./audit";
