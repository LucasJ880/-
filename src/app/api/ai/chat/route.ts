import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { recordAiCall, extractUsage } from "@/lib/ai/monitor";

export const maxDuration = 60;
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
  getProjectAiMemory,
  buildMemoryBlock,
} from "@/lib/ai";

const AI_CHAT_RATE_LIMIT = {
  name: "ai-chat",
  windowMs: 60_000,
  maxRequests: 30,
} as const;

export const POST = withAuth(async (request, _ctx, user) => {
  const rl = await checkRateLimitAsync(AI_CHAT_RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "未配置 AI API 密钥，请在 .env 中设置 OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  const { messages: rawMessages } = await request.json();

  const [workContext, prepared] = await Promise.all([
    getWorkContext(user.id, user.role),
    prepareConversation(rawMessages),
  ]);

  let deepBlock = "";
  let memoryBlock = "";
  const lastUserMsg = [...prepared.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg) {
    const matched = matchProjectByName(
      lastUserMsg.content ?? "",
      workContext.projects
    );
    if (matched) {
      const [deep, memory] = await Promise.all([
        getProjectDeepContext(matched.id),
        getProjectAiMemory(matched.id),
      ]);
      if (deep) deepBlock = buildProjectDeepBlock(deep);
      memoryBlock = buildMemoryBlock(memory);
    }
  }

  const systemPrompt =
    getChatSystemPrompt() +
    buildContextBlock(workContext) +
    deepBlock +
    memoryBlock +
    buildSummaryPrefix(prepared.summarizedContext);

  const stream = await createChatStream({
    systemPrompt,
    messages: prepared.messages,
    mode: prepared.mode,
    signal: request.signal,
  });

  const encoder = new TextEncoder();
  const t0 = Date.now();

  const readable = new ReadableStream({
    async start(controller) {
      let lastChunk: unknown = null;
      try {
        for await (const chunk of stream) {
          lastChunk = chunk;
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ content: delta })}\n\n`
              )
            );
          }
        }
        const usage = extractUsage(lastChunk);
        recordAiCall({
          model: prepared.mode ? `chat-${prepared.mode}` : "chat",
          success: true,
          elapsedMs: Date.now() - t0,
          source: "ai-chat-stream",
          ...usage,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        recordAiCall({
          model: "chat-stream",
          success: false,
          elapsedMs: Date.now() - t0,
          source: "ai-chat-stream",
          error: err instanceof Error ? err.message : String(err),
        });
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
