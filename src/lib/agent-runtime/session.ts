/**
 * AgentSession — 渠道会话持久化（org 隔离）
 */

import { db } from "@/lib/db";

export async function getOrCreateAgentSession(input: {
  orgId: string;
  userId: string;
  channel: string;
  channelUserId: string;
  channelConversationId?: string | null;
}) {
  if (!input.orgId) throw new Error("orgId 必填");
  if (!input.userId) throw new Error("userId 必填");

  const existing = await db.agentSession.findFirst({
    where: {
      orgId: input.orgId,
      userId: input.userId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      status: "active",
    },
    orderBy: { lastActiveAt: "desc" },
  });

  if (existing) {
    return db.agentSession.update({
      where: { id: existing.id },
      data: {
        lastActiveAt: new Date(),
        ...(input.channelConversationId
          ? { channelConversationId: input.channelConversationId }
          : {}),
      },
    });
  }

  return db.agentSession.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      channelConversationId: input.channelConversationId || null,
      status: "active",
      lastActiveAt: new Date(),
    },
  });
}

export async function updateAgentSessionContext(input: {
  orgId: string;
  sessionId: string;
  currentProjectId?: string | null;
  currentCustomerId?: string | null;
  currentOpportunityId?: string | null;
  currentQuoteId?: string | null;
}) {
  const session = await db.agentSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
    select: { id: true },
  });
  if (!session) throw new Error("Session 不存在或跨组织");

  return db.agentSession.update({
    where: { id: session.id },
    data: {
      ...(input.currentProjectId !== undefined
        ? { currentProjectId: input.currentProjectId }
        : {}),
      ...(input.currentCustomerId !== undefined
        ? { currentCustomerId: input.currentCustomerId }
        : {}),
      ...(input.currentOpportunityId !== undefined
        ? { currentOpportunityId: input.currentOpportunityId }
        : {}),
      ...(input.currentQuoteId !== undefined
        ? { currentQuoteId: input.currentQuoteId }
        : {}),
      lastActiveAt: new Date(),
    },
  });
}

export async function updateAgentSessionResponseId(input: {
  orgId: string;
  sessionId: string;
  lastResponseId: string;
}) {
  const session = await db.agentSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
    select: { id: true },
  });
  if (!session) throw new Error("Session 不存在或跨组织");
  return db.agentSession.update({
    where: { id: session.id },
    data: {
      lastResponseId: input.lastResponseId.slice(0, 200),
      lastActiveAt: new Date(),
    },
  });
}

/** summary 仅存压缩摘要，截断防无限追加 */
export async function updateAgentSessionSummary(input: {
  orgId: string;
  sessionId: string;
  summary: string;
}) {
  const session = await db.agentSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
    select: { id: true },
  });
  if (!session) throw new Error("Session 不存在或跨组织");
  return db.agentSession.update({
    where: { id: session.id },
    data: {
      summary: input.summary.trim().slice(0, 2000),
      lastActiveAt: new Date(),
    },
  });
}
