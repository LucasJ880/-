/**
 * Mention Gateway（M1 Mock PoC）— 对外出口
 *
 * 只读 / fail-closed / 零 Schema 变更；仅 Mock 适配器。
 */

export type {
  MentionProvider,
  MentionChannelType,
  MentionEvent,
  MentionContextType,
  MentionCanonicalContextType,
  ExternalIdentityProvider,
  ExternalIdentityStatus,
  ExternalIdentityVerificationMethod,
  ChannelContextBinding,
  MentionAudience,
  AudiencePolicy,
  MentionReplyTarget,
  MentionSendResult,
  MentionReceiveResult,
  ChannelAdapter,
  MentionStage,
  MentionGatewayErrorCode,
  MentionHandleSuccess,
  MentionHandleFailure,
  MentionHandleResult,
} from "./types";
export {
  EXTERNAL_IDENTITY_PROVIDERS,
  EXTERNAL_IDENTITY_STATUSES,
  EXTERNAL_IDENTITY_VERIFICATION_METHODS,
  VERIFIED_IDENTITY_METHODS,
} from "./types";
export {
  resolveProviderTenantOwnership,
  createDefaultOwnershipDeps,
} from "./provider-tenant-ownership";
export type {
  ProviderTenantOwnership,
  OwnershipDeps,
  ProviderGatewayRecord,
} from "./provider-tenant-ownership";
export {
  adminProvisionIdentity,
  verifyIdentity,
  relinkIdentity,
  disableIdentity,
  enableIdentity,
  revokeIdentity,
  listIdentitiesForUser,
  listIdentitiesForAdmin,
  lookupExternalIdentityRecord,
  decideProvisionOutcome,
  normalizeIdentityKey,
  hashProviderUserId,
  commitIdentityTransition,
} from "./identity-service";
export type {
  ExternalIdentityRecord,
  IdentityServiceResult,
  IdentityServiceErrorCode,
  IdentityTransitionPlan,
} from "./identity-service";
export {
  resolveLegacyProviderTenant,
  mapLegacyIdentityStatus,
  decideBackfillAction,
  gatewayMapKey,
  buildCorpOrgIndex,
} from "./backfill";
export {
  MENTION_GATEWAY_M1_MAX_RISK,
  MENTION_GATEWAY_M1_MEMORY_WRITE_HARD_OFF,
  MENTION_GATEWAY_M1_EXTERNAL_SEND_HARD_OFF,
  isMentionGatewayEnabled,
  isMentionGatewayEnabledWithEnv,
  isMentionMockEnabled,
  isMentionMockEnabledWithEnv,
  isMentionMockRuntimeAllowedWithEnv,
  isMentionMemoryWriteEnabledWithEnv,
  isMentionExternalSendEnabledWithEnv,
  resolveMentionGatewayMaxRisk,
  resolveMentionGatewayMaxRiskWithEnv,
  resolveMentionIdentitySourceWithEnv,
  isMentionRequireVerifiedIdentityEnabledWithEnv,
  isMentionIdentityAdminEnabledWithEnv,
  describeMentionGatewayFlags,
} from "./flags";
export type { MentionIdentitySource } from "./flags";
export {
  PROJECT_CONTEXT_TOOLS,
  CUSTOMER_CONTEXT_TOOLS,
  ORG_WIDE_SALES_TOOLS,
  MENTION_CONTEXT_TOOL_POLICY,
  MENTION_GATEWAY_TOOL_UNIVERSE,
  toCanonicalContextType,
  resolveMentionToolPolicy,
  MENTION_GATEWAY_M1_TOOL_ALLOWLIST,
  MENTION_GATEWAY_M1_BLOCKED_L0_TOOLS,
  MENTION_GATEWAY_FORBIDDEN_TOOL_NAME_PATTERN,
  MENTION_GATEWAY_M1_DOMAINS,
  MENTION_AUDIENCE_POLICY,
  MENTION_AGENT_ID,
  evaluateAudience,
  buildMentionSystemPrompt,
  buildMentionRunOptions,
} from "./policy";
export type { MentionContextToolPolicy } from "./policy";
export {
  MentionFixtureStore,
  MentionFixtureSetSchema,
  getDefaultMentionFixtureStore,
  registerMockIdentity,
  registerMockChannelBinding,
  clearMockFixtures,
  parseMentionFixtureJson,
  loadMockFixturesFromEnv,
} from "./fixtures";
export { resolveMentionIdentity, pickMembershipOrg } from "./identity";
export type { IdentityDeps, ResolvedMentionIdentity } from "./identity";
export {
  resolveMentionContext,
  verifyBindingOrganization,
  bindingToScopeInput,
} from "./context";
export type { ContextDeps, ResolvedMentionContext } from "./context";
export {
  buildMentionConversationKey,
  buildMentionSessionChannel,
  buildMentionUserMessageId,
  buildMentionSessionKey,
} from "./session";
export {
  handleMentionEvent,
  createDefaultMentionGatewayDeps,
  DuplicateEventGuard,
  buildMentionDedupeKey,
} from "./handle";
export type {
  HandleMentionInput,
  MentionGatewayDeps,
  MentionRuntimeDeps,
} from "./handle";
export {
  MockChannelAdapter,
  MockMentionEventInputSchema,
  normalizeMockMentionEvent,
  detectAndStripMention,
  getDefaultMockChannelAdapter,
} from "./adapters/mock";
