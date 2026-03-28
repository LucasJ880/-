import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return new Response(
      JSON.stringify({ error: "未登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!isAIConfigured()) {
    return new Response(
      JSON.stringify({ error: "未配置 AI API 密钥，请在 .env 中设置 OPENAI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
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

  try {
    const stream = await createChatStream({
      systemPrompt,
      messages: prepared.messages,
      mode: prepared.mode,
    });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ content: delta })}\n\n`
                )
              );
            }
          }
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
