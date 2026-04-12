/**
 * POST /api/trade/chat/[sessionId]/messages
 *
 * 发送消息并获取 AI 回复（非流式，简洁实现）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { processChat, type ChatMessage } from "@/lib/trade/chat-assistant";

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

  let aiResponse: string;
  try {
    aiResponse = await processChat(session.orgId, body.content.trim(), chatHistory.slice(0, -1));
  } catch (e) {
    aiResponse = `抱歉，AI 处理出错: ${e instanceof Error ? e.message : "未知错误"}。请稍后再试。`;
  }

  const assistantMsg = await db.tradeChatMessage.create({
    data: { sessionId, role: "assistant", content: aiResponse },
  });

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
