import { NextRequest } from "next/server";
import { getAIClient, getModel } from "@/lib/ai";
import { getSystemPrompt, buildContextBlock } from "@/lib/prompts";
import { getCurrentUser } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import { myTasksWhere } from "@/lib/tasks/access";
import { visibleProjectsWhere } from "@/lib/projects/visibility";
import { db } from "@/lib/db";

async function getWorkContext(user: AuthUser) {
  const visibleProjects = await visibleProjectsWhere(user);
  const [projects, recentTasks] = await Promise.all([
    db.project.findMany({
      where: { ...visibleProjects, status: "active" },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    db.task.findMany({
      where: {
        ...myTasksWhere(user.id),
        status: { notIn: ["done", "cancelled"] },
      },
      select: {
        title: true,
        priority: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    projects,
    recentTasks: recentTasks.map((t) => ({
      title: t.title,
      priority: t.priority,
      projectName: t.project?.name ?? null,
    })),
  };
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages 必须是非空数组" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "未配置 AI API 密钥，请在 .env 中设置 OPENAI_API_KEY",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const client = getAIClient();
  const model = getModel();

  const workContext = await getWorkContext(user);
  const contextBlock = buildContextBlock(workContext);

  const systemMessage = {
    role: "system" as const,
    content: getSystemPrompt() + contextBlock,
  };

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [systemMessage, ...messages],
      stream: true,
      temperature: 0.7,
      max_tokens: 1500,
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
