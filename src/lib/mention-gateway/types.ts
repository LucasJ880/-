/**
 * Mention Gateway — M1 内部事件 / 适配器 / 结果类型
 *
 * 本模块只定义类型，不持有状态、不访问 DB。
 *
 * 边界（M1 冻结）：
 * - provider 仅 "mock"（真实 Slack / 企微 / 微信适配器属 M2，本轮不实现）
 * - 受众仅 initiating_user_only（DM / 私有线程）；public channel / group broadcast
 *   / shared workspace / anonymous caller 一律不支持
 * - 业务上下文只能来自显式 ChannelContextBinding，不允许模型猜测
 */

import type { ToolRisk } from "@/lib/agent-core/types";

export type MentionProvider = "mock";

/** M1 允许的会话形态：私聊或私有线程。任何其它值 → AUDIENCE_DENIED */
export type MentionChannelType = "dm" | "thread";

export interface MentionEvent {
  provider: MentionProvider;
  /** 渠道侧事件 id（幂等键之一） */
  eventId: string;
  channel: {
    id: string;
    type: MentionChannelType;
  };
  threadId?: string;
  /** 渠道侧消息 id（幂等键之二，落 AgentRun.userMessageId） */
  messageId: string;
  /** 渠道侧发言人 id —— 只是外部身份，不是青砚用户 */
  externalUserId: string;
  /** 已去掉 @青砚 前缀的正文 */
  text: string;
  mentionedAgent: boolean;
  /** ISO-8601 */
  timestamp: string;
}

export type MentionContextType = "project" | "tender" | "sales";

/**
 * 频道 → 业务上下文绑定（M1：fixture / 内存，不落库）。
 * organizationId 只是「声明」，resolver 必须用真实 membership 复验。
 */
export interface ChannelContextBinding {
  provider: MentionProvider;
  channelId: string;
  threadId?: string;
  organizationId: string;
  contextType: MentionContextType;
  contextId: string;
}

export type MentionAudience = "initiating_user_only";

export interface AudiencePolicy {
  audience: MentionAudience;
  allowedChannelTypes: readonly MentionChannelType[];
}

export interface MentionReplyTarget {
  provider: MentionProvider;
  externalUserId: string;
  channelId: string;
  threadId?: string;
  audience: MentionAudience;
}

export type MentionSendResult =
  | { ok: true; externalMsgId?: string }
  | { ok: false; error: string };

export type MentionReceiveResult =
  | { ok: true; event: MentionEvent }
  | { ok: false; code: "INVALID_EVENT" | "AUDIENCE_DENIED"; message: string };

/**
 * 渠道适配器（M1 仅 Mock 实现）。
 * - receiveEvent：校验 + 归一化，不做任何业务解析
 * - sendMessage：只能把文本送给 initiating user；M1 不得触达任何外部系统
 */
export interface ChannelAdapter {
  readonly provider: MentionProvider;
  receiveEvent(raw: unknown): MentionReceiveResult;
  sendMessage(target: MentionReplyTarget, text: string): Promise<MentionSendResult>;
}

export type MentionStage =
  | "flags"
  | "event"
  | "mention"
  | "audience"
  | "idempotency"
  | "identity"
  | "tenant"
  | "binding"
  | "binding_org"
  | "context"
  | "scope"
  | "session"
  | "run"
  | "tools"
  | "agent"
  | "complete"
  | "deliver";

export type MentionGatewayErrorCode =
  | "GATEWAY_DISABLED"
  | "MOCK_DISABLED"
  | "INVALID_EVENT"
  | "NOT_MENTIONED"
  | "AUDIENCE_DENIED"
  | "DUPLICATE_EVENT"
  | "IDENTITY_OR_MEMBERSHIP_DENIED"
  | "CONTEXT_UNRESOLVED"
  | "CHANNEL_ORG_MISMATCH"
  | "SCOPE_DENIED"
  | "SESSION_FAILED"
  | "RUN_CREATE_FAILED"
  | "RUN_FAILED"
  | "DELIVERY_FAILED"
  /** 回复已送达，但 completeRun 失败；Run 以 failed 终态标记（可追踪），不返回完全成功 */
  | "RUN_FINALIZE_FAILED";

export interface MentionHandleSuccess {
  ok: true;
  status: "completed";
  runId: string;
  sessionId: string;
  context: { type: MentionContextType; id: string };
  response: string;
  audience: MentionAudience;
  delivered: boolean;
  toolCalls: number;
  maxRisk: ToolRisk;
}

export interface MentionHandleFailure {
  ok: false;
  status: "rejected" | "failed" | "duplicate" | "ignored";
  code: MentionGatewayErrorCode;
  /** 对外安全文案（不含租户 id / DB / 鉴权细节 / 提示词 / 工具细节） */
  message: string;
  stage: MentionStage;
  runId?: string;
  /** 已建 Run 后的失败：回复是否已送达 initiating user（RUN_FINALIZE_FAILED 时为 true） */
  delivered?: boolean;
}

export type MentionHandleResult = MentionHandleSuccess | MentionHandleFailure;
