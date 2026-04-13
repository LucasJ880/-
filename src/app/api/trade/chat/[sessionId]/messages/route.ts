/**
 * POST /api/trade/chat/[sessionId]/messages
 *
 * 发送消息并获取 AI 回复（非流式，简洁实现）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { processChat, processChatV2, type ChatMessage } from "@/lib/trade/chat-assistant";
import { extractMemoriesFromConversation, saveMemories } from "@/lib/ai/user-memory";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { sessionId } = await params;
  const body = await request.json();

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const session = await db.tradeChatSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== auth.user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  await db.tradeChatMessage.create({
    data: { sessionId, role: "user", content: body.content.trim() },
  });

  const history = await db.tradeChatMessage.findMany({
    where: { sessionId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const chatHistory: ChatMessage[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const useV2 = process.env.AGENT_CORE_ENABLED === "true";
  let aiResponse: string;
  try {
    const chatFn = useV2 ? processChatV2 : processChat;
    aiResponse = await chatFn(session.orgId, auth.user.id, body.content.trim(), chatHistory.slice(0, -1));
  } catch (e) {
    aiResponse = `抱歉，AI 处理出错: ${e instanceof Error ? e.message : "未知错误"}。请稍后再试。`;
  }

  const assistantMsg = await db.tradeChatMessage.create({
    data: { sessionId, role: "assistant", content: aiResponse },
  });

  // 自动提取记忆（异步，不阻塞响应）
  extractAndSaveMemories(auth.user.id, body.content.trim(), aiResponse).catch(() => {});

  // 异步增量索引（用于跨会话搜索）
  indexNewMessages(auth.user.id, session.orgId, sessionId).catch(() => {});

  const isFirstMessage = history.length <= 1;
  if (isFirstMessage) {
    const title = body.content.trim().slice(0, 30) + (body.content.trim().length > 30 ? "..." : "");
    await db.tradeChatSession.update({
      where: { id: sessionId },
      data: { title, updatedAt: new Date() },
    });
  } else {
    await db.tradeChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  return NextResponse.json({
    userMessage: { role: "user", content: body.content.trim() },
    assistantMessage: { id: assistantMsg.id, role: "assistant", content: aiResponse },
  });
}

async function indexNewMessages(userId: string, orgId: string, sessionId: string) {
  const { indexTradeChatMessages } = await import("@/lib/context/search-engine");
  await indexTradeChatMessages(userId, orgId, sessionId);
}

async function extractAndSaveMemories(userId: string, userMsg: string, aiReply: string) {
  const extracted = extractMemoriesFromConversation(userMsg, aiReply);
  if (extracted.length === 0) return;

  await saveMemories(
    userId,
    extracted.map((e) => ({
      memoryType: e.memoryType,
      content: e.content,
      layer: e.importance >= 4 ? 1 : 2,
      tags: e.tags,
      importance: e.importance,
    })),
  );
}
