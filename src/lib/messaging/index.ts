export { handleInboundMessage, pushMessage, registerAdapter, getAdapter, listAdapters } from "./gateway";
export {
  createBinding,
  findBindingByExternal,
  findBindingsByUser,
  resolveBindingOrgId,
  updateBindingPreferences,
  removeBinding,
  sanitizeBindingPreferences,
} from "./binding";
export type { BindingPreferences, CreateBindingResult } from "./binding";
export {
  BIND_CODE_VALID_MINUTES,
  PERSONAL_WECHAT_BIND_COMMAND,
  bindCodeKeyFromEnv,
  buildUnboundReply,
  decideBindingClaim,
  formatBindCode,
  isPersonalWeChatBindCommand,
  issueBindCode,
  normalizeBindCode,
  verifyBindCode,
} from "./binding-proof";
export type { BindingClaimDecision } from "./binding-proof";
export {
  PLATFORM_WECOM_ORG_ID,
  PLATFORM_WECOM_QUERY,
  isPlatformWecomOrgKey,
  resolveWecomCredentialOrgId,
} from "./platform-wecom";
export {
  pushDailyBriefing,
  pushFollowupReminder,
  pushWeeklyReport,
  pushSalesReminder,
  pushNotification,
  pushBriefingToAllUsers,
  pushFollowupsToAllUsers,
} from "./push-service";
export { PersonalWeChatAdapter } from "./adapters/personal-wechat";
export { WeComAdapter } from "./adapters/wecom";
export type {
  ChannelType,
  AdapterStatus,
  MessagingAdapter,
  InboundMessage,
  OutboundMessage,
  BindingInfo,
  GatewayStatus,
  WeComConfig,
} from "./types";
