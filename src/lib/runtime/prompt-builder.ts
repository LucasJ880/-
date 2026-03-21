import type { LLMMessage } from "./types";
import { db } from "@/lib/db";

interface PromptBuildContext {
  conversationId: string;
  systemPromptSnapshot?: string | null;
  agentBehaviorNote?: string | null;
  kbContext?: string | null;
  maxHistoryMessages?: number;
}

export async function buildMessages(ctx: PromptBuildContext): Promise<LLMMessage[]> {
  const messages: LLMMessage[] = [];

  const systemParts: string[] = [];
  if (ctx.systemPromptSnapshot) {
    systemParts.push(ctx.systemPromptSnapshot);
  }
  if (ctx.agentBehaviorNote) {
    systemParts.push(ctx.agentBehaviorNote);
  }
  if (ctx.kbContext) {
    systemParts.push(
      "以下是来自知识库的参考内容，请在回答时优先参考：\n\n" + ctx.kbContext
    );
  }

  if (systemParts.length > 0) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }

  const limit = ctx.maxHistoryMessages ?? 50;
  const history = await db.message.findMany({
    where: { conversationId: ctx.conversationId },
    orderBy: { sequence: "asc" },
    take: limit,
    select: {
      role: true,
      content: true,
      toolName: true,
      toolCallId: true,
      metadataJson: true,
    },
  });

  for (const msg of history) {
    const role = mapRole(msg.role);

    if (role === "tool") {
      messages.push({
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId ?? undefined,
        name: msg.toolName ?? undefined,
      });
    } else if (role === "assistant" && msg.metadataJson) {
      let toolCalls;
      try {
        const meta = JSON.parse(msg.metadataJson);
        toolCalls = meta.toolCalls;
      } catch { /* ignore */ }

      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        messages.push({ role: "assistant", content: msg.content || "" });
      } else {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else {
      messages.push({ role, content: msg.content });
    }
  }

  return messages;
}

function mapRole(dbRole: string): "system" | "user" | "assistant" | "tool" {
  switch (dbRole) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "user";
  }
}
