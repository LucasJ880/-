import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  isAIConfigured,
  createChatStream,
  getChatSystemPrompt,
  buildContextBlock,
  buildProjectDeepBlock,
  getWorkContext,
  getProjectDeepContext,
  matchProjectByName,
  prepareConversation,
  buildSummaryPrefix,
  extractWorkSuggestion,
  type ChatMessage,
} from "@/lib/ai";

type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { threadId } = await ctx.params;

  const thread = await db.aiThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const take = 60;

  const messages = await db.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      role: true,
      content: true,
      workSuggestion: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    messages,
    hasMore: messages.length === take,
    nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "未配置 AI API 密钥" },
      { status: 500 }
    );
  }

  const { threadId } = await ctx.params;

  const thread = await db.aiThread.findUnique({
    where: { id: threadId },
    select: { userId: true, projectId: true, title: true },
  });
  if (!thread || thread.userId !== user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const body = await request.json();
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "消息过长" }, { status: 400 });
  }

  await db.aiMessage.create({
    data: { threadId, role: "user", content },
  });

  const history = await db.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const chatMessages: ChatMessage[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const [workContext, prepared] = await Promise.all([
    getWorkContext(user.id, user.role),
    prepareConversation(chatMessages),
  ]);

  let deepBlock = "";
  if (thread.projectId) {
    const deep = await getProjectDeepContext(thread.projectId);
    if (deep) deepBlock = buildProjectDeepBlock(deep);
  } else {
    const matched = matchProjectByName(content, workContext.projects);
    if (matched) {
      const deep = await getProjectDeepContext(matched.id);
      if (deep) deepBlock = buildProjectDeepBlock(deep);
    }
  }

  const systemPrompt =
    getChatSystemPrompt() +
    buildContextBlock(workContext) +
    deepBlock +
    buildSummaryPrefix(prepared.summarizedContext);

  const isFirstMessage = history.length === 1;

  try {
    const stream = await createChatStream({
      systemPrompt,
      messages: prepared.messages,
      mode: prepared.mode,
    });

    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ content: delta })}\n\n`
                )
              );
            }
          }

          const { cleanText, suggestion } = extractWorkSuggestion(fullText);

          await db.$transaction([
            db.aiMessage.create({
              data: {
                threadId,
                role: "assistant",
                content: cleanText,
                workSuggestion: suggestion ? (suggestion as object) : undefined,
              },
            }),
            db.aiThread.update({
              where: { id: threadId },
              data: {
                lastMessageAt: new Date(),
                ...(isFirstMessage && thread.title === "新对话"
                  ? { title: content.slice(0, 60) }
                  : {}),
              },
            }),
          ]);

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "AI 服务调用失败";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: message })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI 服务连接失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
