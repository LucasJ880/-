/**
 * 项目讨论 — 核心服务层
 */

import { db } from "@/lib/db";
import type { DiscussionMessage, DiscussionOverview } from "./types";
import { DEFAULT_PAGE_SIZE, MESSAGE_MAX_LENGTH } from "./types";

const senderSelect = {
  id: true,
  name: true,
  avatar: true,
} as const;

function toMessage(row: Record<string, unknown>): DiscussionMessage {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    conversationId: r.conversationId as string,
    projectId: r.projectId as string,
    senderId: (r.senderId as string) ?? null,
    sender: r.sender
      ? (r.sender as DiscussionMessage["sender"])
      : null,
    type: r.type as DiscussionMessage["type"],
    body: r.body as string,
    metadata: r.metadata as DiscussionMessage["metadata"],
    replyToId: (r.replyToId as string) ?? null,
    editedAt: r.editedAt ? (r.editedAt as Date).toISOString() : null,
    deletedAt: r.deletedAt ? (r.deletedAt as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
  };
}

/**
 * 获取或创建项目的主讨论会话（lazy init）
 */
export async function getOrCreateMainConversation(projectId: string) {
  let conv = await db.projectConversation.findUnique({
    where: { projectId },
  });
  if (!conv) {
    conv = await db.projectConversation.create({
      data: { projectId, kind: "MAIN", title: "项目讨论" },
    });
  }
  return conv;
}

/**
 * 获取讨论概览（会话信息 + 最新消息 + 统计）
 */
export async function getDiscussionOverview(
  projectId: string,
  opts?: { pageSize?: number; cursor?: string }
): Promise<DiscussionOverview> {
  const conv = await getOrCreateMainConversation(projectId);
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;

  const whereBase: Record<string, unknown> = {
    conversationId: conv.id,
    deletedAt: null,
  };
  if (opts?.cursor) {
    whereBase.createdAt = { lt: new Date(opts.cursor) };
  }

  const [rows, messageCount, memberCount] = await Promise.all([
    db.projectMessage.findMany({
      where: whereBase,
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      include: { sender: { select: senderSelect } },
    }),
    db.projectMessage.count({
      where: { conversationId: conv.id, deletedAt: null },
    }),
    db.projectMember.count({
      where: { projectId, status: "active" },
    }),
  ]);

  const hasMore = rows.length > pageSize;
  const slice = hasMore ? rows.slice(0, pageSize) : rows;
  const messages = slice.reverse().map(toMessage);
  const nextCursor = hasMore
    ? slice[0].createdAt.toISOString()
    : null;

  return {
    conversation: {
      id: conv.id,
      projectId: conv.projectId,
      kind: conv.kind,
      title: conv.title,
      archivedAt: conv.archivedAt?.toISOString() ?? null,
      createdAt: conv.createdAt.toISOString(),
    },
    memberCount,
    messageCount,
    messages,
    hasMore,
    nextCursor,
  };
}

/**
 * 发送文本消息
 */
export async function sendMessage(
  projectId: string,
  senderId: string,
  body: string,
  replyToId?: string
): Promise<DiscussionMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("消息内容不能为空");
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`消息长度不能超过 ${MESSAGE_MAX_LENGTH} 字`);
  }

  const conv = await getOrCreateMainConversation(projectId);

  const msg = await db.projectMessage.create({
    data: {
      conversationId: conv.id,
      projectId,
      senderId,
      type: "TEXT",
      body: trimmed,
      replyToId: replyToId ?? null,
    },
    include: { sender: { select: senderSelect } },
  });

  return toMessage(msg as unknown as Record<string, unknown>);
}

/**
 * 加载更早消息（cursor 分页）
 */
export async function loadOlderMessages(
  projectId: string,
  cursor: string,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<{
  messages: DiscussionMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const conv = await getOrCreateMainConversation(projectId);

  const rows = await db.projectMessage.findMany({
    where: {
      conversationId: conv.id,
      deletedAt: null,
      createdAt: { lt: new Date(cursor) },
    },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    include: { sender: { select: senderSelect } },
  });

  const hasMore = rows.length > pageSize;
  const slice = hasMore ? rows.slice(0, pageSize) : rows;
  const messages = slice.reverse().map(toMessage);
  const nextCursor = hasMore
    ? slice[0].createdAt.toISOString()
    : null;

  return { messages, hasMore, nextCursor };
}
