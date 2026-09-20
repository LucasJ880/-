/**
 * POST /api/trade/chat/[sessionId]/messages
 *
 * 发送消息并获取 AI 回复（非流式，简洁实现）
 *
 * 附件：浏览器先经 /api/ai/upload-file 把文件解析成文本，再随消息提交
 * `attachments: [{ name, size, text }]`。正文存到 TradeChatMessage.attachments，
 * 组装模型输入时按预算展开（见 src/lib/trade/chat-attachments.ts）。
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { processChat, processChatV2, type ChatMessage } from "@/lib/trade/chat-assistant";
import { extractMemoriesFromConversation, saveMemories } from "@/lib/ai/user-memory";
import { resolveTradeOrgId } from "@/lib/trade/access";
import {
  attachmentBlobPathBelongsTo,
  attachmentsTitleSource,
  parseAttachmentsInput,
  readStoredAttachments,
  renderTurnsForModel,
  summarizeAttachments,
  type ModelTurnInput,
} from "@/lib/trade/chat-attachments";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parsedAttachments = parseAttachmentsInput(body.attachments);
  if (!parsedAttachments.ok) {
    return NextResponse.json({ error: parsedAttachments.error }, { status: 400 });
  }
  const attachments = parsedAttachments.attachments;
  // 图片原图路径必须落在当前 org 的前缀下（浏览器传来的值不可信）
  const foreignBlob = attachments.find(
    (a) => a.blobPath && !attachmentBlobPathBelongsTo(a.blobPath, orgRes.orgId),
  );
  if (foreignBlob) {
    return NextResponse.json({ error: `附件「${foreignBlob.name}」不属于当前组织` }, { status: 400 });
  }

  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const { sessionId } = await params;
  const session = await db.tradeChatSession.findFirst({
    where: { id: sessionId, userId: auth.user.id, orgId: orgRes.orgId },
  });
  if (!session) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const userMsg = await db.tradeChatMessage.create({
    data: {
      sessionId,
      role: "user",
      content,
      ...(attachments.length > 0
        ? { attachments: attachments as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });

  const history = await db.tradeChatMessage.findMany({
    where: { sessionId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, attachments: true },
  });

  // 把带附件的轮次展开成模型可读的纯文本：最新附件优先拿预算，旧附件留桩
  const turns: ModelTurnInput[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    attachments: readStoredAttachments(m.attachments),
  }));
  const rendered = renderTurnsForModel(turns);
  let currentIdx = history.findIndex((m) => m.id === userMsg.id);
  if (currentIdx < 0) currentIdx = rendered.length - 1;
  const modelUserMessage = rendered[currentIdx].content;
  const chatHistory: ChatMessage[] = rendered
    .filter((_, i) => i !== currentIdx)
    .map((m) => ({ role: m.role, content: m.content }));

  const useV2 = process.env.AGENT_CORE_ENABLED === "true";
  let aiResponse: string;
  try {
    const chatFn = useV2 ? processChatV2 : processChat;
    aiResponse = await chatFn(session.orgId, auth.user.id, modelUserMessage, chatHistory);
  } catch (e) {
    aiResponse = `抱歉，AI 处理出错: ${e instanceof Error ? e.message : "未知错误"}。请稍后再试。`;
  }

  const assistantMsg = await db.tradeChatMessage.create({
    data: { sessionId, role: "assistant", content: aiResponse },
  });

  // 记忆抽取只看用户打的字（附件正文不进长期记忆）
  const memorySource =
    content || `上传了附件：${attachments.map((a) => a.name).join("、")}`;
  extractAndSaveMemories(auth.user.id, session.orgId, memorySource, aiResponse).catch(() => {});

  indexNewMessages(auth.user.id, session.orgId, sessionId).catch(() => {});

  const isFirstMessage = history.length <= 1;
  if (isFirstMessage) {
    const titleSource = attachmentsTitleSource(content, attachments);
    const title = titleSource.slice(0, 30) + (titleSource.length > 30 ? "..." : "");
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
    userMessage: {
      id: userMsg.id,
      role: "user",
      content,
      attachments: summarizeAttachments(attachments),
    },
    assistantMessage: { id: assistantMsg.id, role: "assistant", content: aiResponse },
  });
}

async function indexNewMessages(userId: string, orgId: string, sessionId: string) {
  const { indexTradeChatMessages } = await import("@/lib/context/search-engine");
  await indexTradeChatMessages(userId, orgId, sessionId);
}

async function extractAndSaveMemories(
  userId: string,
  orgId: string,
  userMsg: string,
  aiReply: string,
) {
  const extracted = extractMemoriesFromConversation(userMsg, aiReply);
  if (extracted.length === 0) return;

  await saveMemories(
    userId,
    orgId,
    extracted.map((e) => ({
      memoryType: e.memoryType,
      content: e.content,
      layer: e.importance >= 4 ? 1 : 2,
      tags: e.tags,
      importance: e.importance,
    })),
  );
}
