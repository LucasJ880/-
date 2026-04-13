/**
 * 跨会话语义搜索引擎
 *
 * 统一搜索所有会话类型中的历史消息：
 * - AiThread / AiMessage（全局助手）
 * - TradeChatSession / TradeChatMessage（外贸聊天）
 * - Conversation / Message（项目对话）
 * - ProjectConversation / ProjectMessage（项目讨论）
 *
 * 原理：
 * 1. 后台索引：将消息生成嵌入，存入 MessageEmbedding 表
 * 2. 搜索：将查询生成嵌入，与索引进行余弦相似度匹配
 * 3. 排序：按相似度 + 时间衰减排序
 */

import { db } from "@/lib/db";
import { generateEmbedding, generateEmbeddings, cosineSimilarity } from "@/lib/ai/embedding";
import type { MessageSourceType, SearchResult, SearchOptions, IndexStats } from "./types";

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = 0.65;
const INDEX_BATCH_SIZE = 20;

export async function searchHistory(options: SearchOptions): Promise<SearchResult[]> {
  const {
    userId,
    orgId,
    query,
    sourceTypes,
    limit = DEFAULT_LIMIT,
    minSimilarity = DEFAULT_MIN_SIMILARITY,
    dateFrom,
    dateTo,
  } = options;

  const queryEmbedding = await generateEmbedding(query);

  const where: Record<string, unknown> = { userId };
  if (orgId) where.orgId = orgId;
  if (sourceTypes?.length) where.sourceType = { in: sourceTypes };
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  const candidates = await db.messageEmbedding.findMany({
    where,
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      sessionId: true,
      sessionTitle: true,
      role: true,
      content: true,
      embedding: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const scored: SearchResult[] = [];

  for (const candidate of candidates) {
    const emb = candidate.embedding as number[];
    if (!emb || emb.length === 0) continue;

    const similarity = cosineSimilarity(queryEmbedding, emb);
    if (similarity < minSimilarity) continue;

    scored.push({
      id: candidate.id,
      sourceType: candidate.sourceType as MessageSourceType,
      sourceId: candidate.sourceId,
      sessionId: candidate.sessionId,
      sessionTitle: candidate.sessionTitle,
      role: candidate.role,
      content: candidate.content,
      similarity,
      createdAt: candidate.createdAt,
    });
  }

  scored.sort((a, b) => {
    const timeFactor = 0.1;
    const daysDiff = (Date.now() - a.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const daysDiffB = (Date.now() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const scoreA = a.similarity - timeFactor * Math.log1p(daysDiff);
    const scoreB = b.similarity - timeFactor * Math.log1p(daysDiffB);
    return scoreB - scoreA;
  });

  return scored.slice(0, limit);
}

// ── 索引管理 ──────────────────────────────────────────────────

export async function indexAiThreadMessages(
  userId: string,
  threadId?: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    thread: { userId },
    role: { in: ["user", "assistant"] },
  };
  if (threadId) where.threadId = threadId;

  const messages = await db.aiMessage.findMany({
    where,
    select: {
      id: true,
      threadId: true,
      thread: { select: { title: true } },
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return indexMessages(
    userId,
    undefined,
    "ai_message",
    messages.map((m) => ({
      sourceId: m.id,
      sessionId: m.threadId,
      sessionTitle: m.thread.title,
      role: m.role,
      content: m.content,
    })),
  );
}

export async function indexTradeChatMessages(
  userId: string,
  orgId: string,
  sessionId?: string,
): Promise<number> {
  const where: Record<string, unknown> = {
    session: { userId, orgId },
    role: { in: ["user", "assistant"] },
  };
  if (sessionId) where.sessionId = sessionId;

  const messages = await db.tradeChatMessage.findMany({
    where,
    select: {
      id: true,
      sessionId: true,
      session: { select: { title: true } },
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return indexMessages(
    userId,
    orgId,
    "trade_chat",
    messages.map((m) => ({
      sourceId: m.id,
      sessionId: m.sessionId,
      sessionTitle: m.session.title,
      role: m.role,
      content: m.content,
    })),
  );
}

async function indexMessages(
  userId: string,
  orgId: string | undefined,
  sourceType: MessageSourceType,
  messages: {
    sourceId: string;
    sessionId: string;
    sessionTitle: string | null;
    role: string;
    content: string;
  }[],
): Promise<number> {
  if (messages.length === 0) return 0;

  const existing = await db.messageEmbedding.findMany({
    where: {
      sourceType,
      sourceId: { in: messages.map((m) => m.sourceId) },
    },
    select: { sourceId: true },
  });
  const existingSet = new Set(existing.map((e) => e.sourceId));

  const toIndex = messages.filter((m) => !existingSet.has(m.sourceId));
  if (toIndex.length === 0) return 0;

  let indexed = 0;

  for (let i = 0; i < toIndex.length; i += INDEX_BATCH_SIZE) {
    const batch = toIndex.slice(i, i + INDEX_BATCH_SIZE);
    const texts = batch.map((m) => m.content.slice(0, 2000));

    let embeddings: number[][];
    try {
      embeddings = await generateEmbeddings(texts);
    } catch {
      continue;
    }

    const creates = batch.map((m, j) => ({
      userId,
      orgId: orgId ?? null,
      sourceType,
      sourceId: m.sourceId,
      sessionId: m.sessionId,
      sessionTitle: m.sessionTitle,
      role: m.role,
      content: m.content.slice(0, 5000),
      embedding: JSON.parse(JSON.stringify(embeddings[j])),
    }));

    await db.messageEmbedding.createMany({ data: creates, skipDuplicates: true });
    indexed += batch.length;
  }

  return indexed;
}

export async function getIndexStats(userId: string): Promise<IndexStats> {
  const counts = await db.messageEmbedding.groupBy({
    by: ["sourceType"],
    where: { userId },
    _count: { id: true },
  });

  const lastRecord = await db.messageEmbedding.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const bySourceType: Record<string, number> = {};
  let total = 0;
  for (const c of counts) {
    bySourceType[c.sourceType] = c._count.id;
    total += c._count.id;
  }

  return {
    totalIndexed: total,
    bySourceType,
    lastIndexedAt: lastRecord?.createdAt ?? null,
  };
}

export async function rebuildIndex(userId: string, orgId?: string): Promise<number> {
  await db.messageEmbedding.deleteMany({ where: { userId } });

  let total = 0;
  total += await indexAiThreadMessages(userId);
  if (orgId) {
    total += await indexTradeChatMessages(userId, orgId);
  }
  return total;
}
