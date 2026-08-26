/**
 * Mention Gateway — 会话键（M1，零 Schema 变更）
 *
 * 审计结论：AgentSession 有 channelConversationId 列，但 getOrCreateAgentSession
 * 的查找键不含它（同一用户的多个线程会共用一个会话）。
 *
 * M1 方案：复用 AgentSession 表与现有列，不改 agent-runtime/session.ts
 * （避免改变 Web 助手的会话语义）：
 *   channel               = "mention:<provider>"
 *   channelUserId         = externalUserId
 *   channelConversationId = "<provider>:<channelId>:<threadId|->"   （deterministic logical key）
 * 查找时把 channelConversationId 纳入键，实现线程级会话隔离。
 *
 * M1 不写 summary / current*Id（记忆策略：不持久化对话内容）。
 */

import type { MentionEvent } from "./types";

export function buildMentionConversationKey(event: MentionEvent): string {
  // M2-A：加入 provider 租户边界（不同 provider 租户的同名 channelId/threadId 不得共享会话）
  return `${event.provider}:${event.providerTenantId}:${event.channel.id}:${event.threadId ?? "-"}`;
}

export function buildMentionSessionChannel(provider: MentionEvent["provider"]): string {
  return `mention:${provider}`;
}

/** AgentRun.userMessageId（org 作用域幂等键）：<provider>:<providerTenantId>:<channelId>:<messageId>（M2-A 加租户边界；仍 BEST_EFFORT） */
export function buildMentionUserMessageId(event: MentionEvent): string {
  return `${event.provider}:${event.providerTenantId}:${event.channel.id}:${event.messageId}`;
}

export interface MentionSessionKey {
  orgId: string;
  userId: string;
  channel: string;
  channelUserId: string;
  channelConversationId: string;
}

export function buildMentionSessionKey(
  event: MentionEvent,
  identity: { orgId: string; userId: string },
): MentionSessionKey {
  return {
    orgId: identity.orgId,
    userId: identity.userId,
    channel: buildMentionSessionChannel(event.provider),
    channelUserId: event.externalUserId,
    channelConversationId: buildMentionConversationKey(event),
  };
}

/**
 * 真实实现：按完整逻辑键查找 / 创建 AgentSession（现有表、现有列）。
 */
export async function getOrCreateMentionSession(
  key: MentionSessionKey,
): Promise<{ id: string }> {
  if (!key.orgId || !key.userId) throw new Error("orgId / userId 必填");
  const { db } = await import("@/lib/db");
  const existing = await db.agentSession.findFirst({
    where: {
      orgId: key.orgId,
      userId: key.userId,
      channel: key.channel,
      channelUserId: key.channelUserId,
      channelConversationId: key.channelConversationId,
      status: "active",
    },
    orderBy: { lastActiveAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    await db.agentSession.update({
      where: { id: existing.id },
      data: { lastActiveAt: new Date() },
    });
    return { id: existing.id };
  }
  const created = await db.agentSession.create({
    data: {
      orgId: key.orgId,
      userId: key.userId,
      channel: key.channel,
      channelUserId: key.channelUserId,
      channelConversationId: key.channelConversationId,
      status: "active",
      lastActiveAt: new Date(),
    },
    select: { id: true },
  });
  return { id: created.id };
}
