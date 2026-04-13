/**
 * Context 压缩器
 *
 * 将长对话压缩为结构化摘要，持久化存储，用于：
 * 1. 新对话开始时加载历史上下文（"你上次聊过 X"）
 * 2. 跨会话搜索的补充结果
 * 3. Agent 决策时的背景知识
 *
 * 压缩策略：
 * - 提取关键主题（keyTopics）
 * - 提取重要决策（keyDecisions）
 * - 生成 3-5 句摘要
 * - 生成摘要向量嵌入
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { generateEmbedding } from "@/lib/ai/embedding";
import type { SessionSourceType, SessionSummary, CompressOptions } from "./types";

const MIN_MESSAGES_FOR_COMPRESSION = 6;

interface RawMessage {
  role: string;
  content: string;
}

interface CompressionOutput {
  summary: string;
  keyTopics: string[];
  keyDecisions: string[];
}

function parseCompressionOutput(raw: string): CompressionOutput | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.summary && Array.isArray(parsed.keyTopics)) {
      return {
        summary: parsed.summary,
        keyTopics: parsed.keyTopics ?? [],
        keyDecisions: parsed.keyDecisions ?? [],
      };
    }
  } catch {
    /* parse failed */
  }
  return null;
}

async function compressMessages(messages: RawMessage[]): Promise<CompressionOutput> {
  const transcript = messages
    .map((m) => `[${m.role === "user" ? "用户" : "助手"}] ${m.content.slice(0, 400)}`)
    .join("\n");

  const prompt = `请分析以下对话并生成结构化摘要。

对话内容：
${transcript.slice(0, 8000)}

请严格按 JSON 格式输出：
\`\`\`json
{
  "summary": "3-5句话的对话摘要，保留关键信息（人名、公司名、日期、数字、决策）",
  "keyTopics": ["主题1", "主题2", "主题3"],
  "keyDecisions": ["决策1描述", "决策2描述"]
}
\`\`\`

注意：
- summary 要有足够信息密度，读者可以不看原文就理解对话要点
- keyTopics 最多 5 个
- keyDecisions 只记录明确做出的决策，没有则为空数组`;

  const raw = await createCompletion({
    systemPrompt: "你是对话分析助手。请严格按照要求的 JSON 格式输出结构化摘要。",
    userPrompt: prompt,
    mode: "fast",
    maxTokens: 1000,
  });

  const parsed = parseCompressionOutput(raw);
  if (parsed) return parsed;

  return {
    summary: raw.slice(0, 500),
    keyTopics: [],
    keyDecisions: [],
  };
}

export async function compressSession(options: CompressOptions): Promise<SessionSummary | null> {
  const { userId, sourceType, sessionId, force } = options;

  if (!force) {
    const existing = await db.conversationSummary.findUnique({
      where: { sourceType_sessionId: { sourceType, sessionId } },
    });
    if (existing) {
      return {
        sessionId: existing.sessionId,
        sourceType: existing.sourceType as SessionSourceType,
        sessionTitle: existing.sessionTitle,
        summary: existing.summary,
        keyTopics: existing.keyTopics?.split(",").filter(Boolean) ?? [],
        keyDecisions: existing.keyDecisions?.split(",").filter(Boolean) ?? [],
        messageCount: existing.messageCount,
        version: existing.version,
      };
    }
  }

  const { messages, title } = await loadSessionMessages(sourceType, sessionId);

  if (messages.length < MIN_MESSAGES_FOR_COMPRESSION) {
    return null;
  }

  const compressed = await compressMessages(messages);

  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(compressed.summary);
  } catch {
    /* embedding 失败不阻塞 */
  }

  const estimateTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 2), 0);

  const data = {
    userId,
    sourceType,
    sessionId,
    sessionTitle: title,
    summary: compressed.summary,
    keyTopics: compressed.keyTopics.join(","),
    keyDecisions: compressed.keyDecisions.join(","),
    messageCount: messages.length,
    tokenEstimate: estimateTokens,
    embedding: embedding ? JSON.parse(JSON.stringify(embedding)) : undefined,
  };

  await db.conversationSummary.upsert({
    where: { sourceType_sessionId: { sourceType, sessionId } },
    create: data,
    update: {
      ...data,
      version: { increment: 1 },
    },
  });

  return {
    sessionId,
    sourceType,
    sessionTitle: title,
    summary: compressed.summary,
    keyTopics: compressed.keyTopics,
    keyDecisions: compressed.keyDecisions,
    messageCount: messages.length,
    version: 1,
  };
}

async function loadSessionMessages(
  sourceType: SessionSourceType,
  sessionId: string,
): Promise<{ messages: RawMessage[]; title: string | null }> {
  switch (sourceType) {
    case "ai_thread": {
      const thread = await db.aiThread.findUnique({
        where: { id: sessionId },
        select: {
          title: true,
          messages: {
            select: { role: true, content: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          },
        },
      });
      return {
        messages: thread?.messages ?? [],
        title: thread?.title ?? null,
      };
    }
    case "trade_chat_session": {
      const session = await db.tradeChatSession.findUnique({
        where: { id: sessionId },
        select: {
          title: true,
          messages: {
            where: { role: { in: ["user", "assistant"] } },
            select: { role: true, content: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          },
        },
      });
      return {
        messages: session?.messages ?? [],
        title: session?.title ?? null,
      };
    }
    case "conversation": {
      const conv = await db.conversation.findUnique({
        where: { id: sessionId },
        select: {
          title: true,
          messages: {
            where: { role: { in: ["user", "assistant"] } },
            select: { role: true, content: true },
            orderBy: { sequence: "asc" },
            take: 100,
          },
        },
      });
      return {
        messages: conv?.messages ?? [],
        title: conv?.title ?? null,
      };
    }
    default:
      return { messages: [], title: null };
  }
}

export async function compressAllUserSessions(
  userId: string,
  orgId?: string,
): Promise<number> {
  let compressed = 0;

  const threads = await db.aiThread.findMany({
    where: { userId },
    select: { id: true, _count: { select: { messages: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });

  for (const t of threads) {
    if (t._count.messages < MIN_MESSAGES_FOR_COMPRESSION) continue;
    const result = await compressSession({
      userId,
      sourceType: "ai_thread",
      sessionId: t.id,
    });
    if (result) compressed++;
  }

  if (orgId) {
    const tradeSessions = await db.tradeChatSession.findMany({
      where: { userId, orgId },
      select: { id: true, _count: { select: { messages: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    for (const s of tradeSessions) {
      if (s._count.messages < MIN_MESSAGES_FOR_COMPRESSION) continue;
      const result = await compressSession({
        userId,
        sourceType: "trade_chat_session",
        sessionId: s.id,
      });
      if (result) compressed++;
    }
  }

  return compressed;
}

export async function getSessionSummary(
  sourceType: SessionSourceType,
  sessionId: string,
): Promise<SessionSummary | null> {
  const row = await db.conversationSummary.findUnique({
    where: { sourceType_sessionId: { sourceType, sessionId } },
  });

  if (!row) return null;

  return {
    sessionId: row.sessionId,
    sourceType: row.sourceType as SessionSourceType,
    sessionTitle: row.sessionTitle,
    summary: row.summary,
    keyTopics: row.keyTopics?.split(",").filter(Boolean) ?? [],
    keyDecisions: row.keyDecisions?.split(",").filter(Boolean) ?? [],
    messageCount: row.messageCount,
    version: row.version,
  };
}

export async function getRecentSummaries(
  userId: string,
  limit = 5,
): Promise<SessionSummary[]> {
  const rows = await db.conversationSummary.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    sessionId: row.sessionId,
    sourceType: row.sourceType as SessionSourceType,
    sessionTitle: row.sessionTitle,
    summary: row.summary,
    keyTopics: row.keyTopics?.split(",").filter(Boolean) ?? [],
    keyDecisions: row.keyDecisions?.split(",").filter(Boolean) ?? [],
    messageCount: row.messageCount,
    version: row.version,
  }));
}
