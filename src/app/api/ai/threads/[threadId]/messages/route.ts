import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
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
  getProjectAiMemory,
  buildMemoryBlock,
  getSalesContext,
  buildSalesContextBlock,
  getWakeUpMemories,
  recallMemories,
  buildUserMemoryBlock,
  extractMemoriesFromConversation,
  saveMemories,
  type ChatMessage,
} from "@/lib/ai";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";

export const GET = withAuth(async (request, ctx, user) => {
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
});

export const POST = withAuth(async (request, ctx, user) => {
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

  const fileText = typeof body.fileText === "string" ? body.fileText : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";

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

  const [workContext, prepared, wakeUp] = await Promise.all([
    getWorkContext(user.id, user.role),
    prepareConversation(chatMessages),
    getWakeUpMemories(user.id),
  ]);

  let deepBlock = "";
  let memoryBlock = "";
  const resolvedProjectId =
    thread.projectId ??
    matchProjectByName(content, workContext.projects)?.id ??
    null;

  if (resolvedProjectId) {
    const [deep, memory] = await Promise.all([
      getProjectDeepContext(resolvedProjectId),
      getProjectAiMemory(resolvedProjectId),
    ]);
    if (deep) deepBlock = buildProjectDeepBlock(deep);
    memoryBlock = buildMemoryBlock(memory);
  }

  const l2Memories = await recallMemories(user.id, content, {
    customerId: undefined,
    projectId: resolvedProjectId ?? undefined,
    limit: 5,
  });
  const userMemoryBlock = buildUserMemoryBlock(wakeUp.l0, wakeUp.l1, l2Memories);

  const fileBlock = fileText
    ? `\n\n<uploaded_document filename="${fileName}">\n${fileText.slice(0, 120000)}\n</uploaded_document>\n\n请基于上述文档内容回答用户问题。使用 Markdown 格式输出（表格、标题、列表、粗体等）。`
    : "";

  const TENDER_KEYWORDS = [
    "标书", "招标", "投标", "tender", "bid", "rfp", "rfq",
    "采购", "procurement", "solicitation", "addendum",
    "中标", "报价策略", "评分", "specification",
  ];
  const SALES_KEYWORDS = [
    "客户", "报价", "跟进", "销售", "成交", "询盘", "pipeline",
    "follow up", "follow-up", "quote", "客户管理", "机会",
    "安装", "测量", "订单", "窗帘", "百叶", "blinds", "shutter",
    "邮件草稿", "draft email", "回复客户",
    "微信", "wechat", "小红书", "xiaohongshu", "facebook", "话术",
  ];
  const combinedText = (content + " " + fileName).toLowerCase();
  const isTenderContext = fileText && TENDER_KEYWORDS.some((kw) => combinedText.includes(kw));
  const isSalesContext = SALES_KEYWORDS.some((kw) => combinedText.includes(kw));

  let expertBlock = "";
  let salesBlock = "";
  let effectiveMode = prepared.mode;

  if (isTenderContext) {
    const tenderPrompt = getExpertSystemPrompt("bid_analyst");
    if (tenderPrompt) {
      expertBlock = `\n\n## 专家角色激活：投标策略分析专家\n${tenderPrompt}\n`;
      effectiveMode = "deep";
    }
  } else if (isSalesContext) {
    const salesPrompt = getExpertSystemPrompt("sales_advisor");
    if (salesPrompt) {
      expertBlock = `\n\n## 专家角色激活：销售顾问\n${salesPrompt}\n`;
    }
    try {
      const salesCtx = await getSalesContext(user.id);
      salesBlock = buildSalesContextBlock(salesCtx);
    } catch {
      // sales context is best-effort
    }
  }

  if (fileText && !isTenderContext) {
    effectiveMode = "deep";
  }

  const systemPrompt =
    getChatSystemPrompt() +
    expertBlock +
    buildContextBlock(workContext) +
    deepBlock +
    memoryBlock +
    userMemoryBlock +
    salesBlock +
    fileBlock +
    buildSummaryPrefix(prepared.summarizedContext);

  const isFirstMessage = history.length === 1;

  const stream = await createChatStream({
    systemPrompt,
    messages: prepared.messages,
    mode: effectiveMode,
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

        extractAndSaveMemories(user.id, content, cleanText, threadId).catch(
          () => {}
        );

        indexThreadMessages(user.id, threadId).catch(() => {});

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

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

async function indexThreadMessages(userId: string, threadId: string) {
  const { indexAiThreadMessages } = await import("@/lib/context/search-engine");
  await indexAiThreadMessages(userId, threadId);
}

async function extractAndSaveMemories(
  userId: string,
  userMessage: string,
  assistantReply: string,
  threadId: string
) {
  const extracted = extractMemoriesFromConversation(userMessage, assistantReply);
  if (extracted.length === 0) return;

  await saveMemories(
    userId,
    extracted.map((m) => ({
      memoryType: m.memoryType,
      content: m.content,
      layer: 1,
      tags: m.tags,
      importance: m.importance,
      sourceThreadId: threadId,
    }))
  );
}
