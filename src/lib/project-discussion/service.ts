/**
 * 项目讨论 — 核心服务层
 *
 * 会话创建使用 upsert 防止并发重复。
 * 分页使用 (createdAt, id) 复合排序保证稳定性。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { DiscussionMessage, DiscussionOverview, MessageMetadata, TextMessageMetadata } from "./types";
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
    sender: r.sender ? (r.sender as DiscussionMessage["sender"]) : null,
    type: r.type as DiscussionMessage["type"],
    body: r.body as string,
    metadata: (r.metadata as MessageMetadata) ?? null,
    replyToId: (r.replyToId as string) ?? null,
    editedAt: r.editedAt ? (r.editedAt as Date).toISOString() : null,
    deletedAt: r.deletedAt ? (r.deletedAt as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
  };
}

/**
 * 获取或创建项目的主讨论会话。
 * 使用 upsert + projectId unique 约束防止并发重复创建。
 */
export async function getOrCreateMainConversation(
  projectId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;
  return client.projectConversation.upsert({
    where: { projectId },
    update: {},
    create: { projectId, kind: "MAIN", title: "项目讨论" },
  });
}

/**
 * 获取讨论概览（会话信息 + 最新消息 + 统计）。
 * cursor 格式: "createdAt_ISO|id"，保证稳定分页。
 */
export async function getDiscussionOverview(
  projectId: string,
  opts?: { pageSize?: number; cursor?: string }
): Promise<DiscussionOverview> {
  const conv = await getOrCreateMainConversation(projectId);
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;

  const whereBase: Prisma.ProjectMessageWhereInput = {
    conversationId: conv.id,
    deletedAt: null,
  };

  if (opts?.cursor) {
    const cursorFilter = parseCursor(opts.cursor);
    if (cursorFilter) {
      whereBase.OR = [
        { createdAt: { lt: cursorFilter.createdAt } },
        { createdAt: cursorFilter.createdAt, id: { lt: cursorFilter.id } },
      ];
    }
  }

  const [rows, messageCount, memberCount] = await Promise.all([
    db.projectMessage.findMany({
      where: whereBase,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
  const messages = slice.reverse().map((r) => toMessage(r as unknown as Record<string, unknown>));
  const nextCursor = hasMore ? buildCursor(slice[0]) : null;

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
  replyToId?: string,
  metadata?: TextMessageMetadata
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
      ...(metadata ? { metadata: metadata as unknown as Prisma.JsonObject } : {}),
    },
    include: { sender: { select: senderSelect } },
  });

  return toMessage(msg as unknown as Record<string, unknown>);
}

/**
 * 加载更早消息（稳定 cursor 分页）
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

  const cursorFilter = parseCursor(cursor);
  const where: Prisma.ProjectMessageWhereInput = {
    conversationId: conv.id,
    deletedAt: null,
  };
  if (cursorFilter) {
    where.OR = [
      { createdAt: { lt: cursorFilter.createdAt } },
      { createdAt: cursorFilter.createdAt, id: { lt: cursorFilter.id } },
    ];
  }

  const rows = await db.projectMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    include: { sender: { select: senderSelect } },
  });

  const hasMore = rows.length > pageSize;
  const slice = hasMore ? rows.slice(0, pageSize) : rows;
  const messages = slice.reverse().map((r) => toMessage(r as unknown as Record<string, unknown>));
  const nextCursor = hasMore ? buildCursor(slice[0]) : null;

  return { messages, hasMore, nextCursor };
}

// ─── cursor helpers ───

function buildCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function parseCursor(cursor: string): { createdAt: Date; id: string } | null {
  const pipe = cursor.indexOf("|");
  if (pipe === -1) {
    const d = new Date(cursor);
    return isNaN(d.getTime()) ? null : { createdAt: d, id: "" };
  }
  const dateStr = cursor.slice(0, pipe);
  const id = cursor.slice(pipe + 1);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : { createdAt: d, id };
}
