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
  describeMentionGatewayFlags,
} from "./flags";
export {
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
  buildMentionEventKey,
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
