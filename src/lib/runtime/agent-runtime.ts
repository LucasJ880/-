import { db } from "@/lib/db";
import { getAIConfig } from "@/lib/ai/config";
import { resolveProvider } from "./provider";
import { buildMessages } from "./prompt-builder";
import { buildKBContext } from "./kb-context";
import { executeTool } from "./tool-executor";
import type {
  ToolDefinition,
  RuntimeRunResult,
  ToolCallRequest,
} from "./types";

const MAX_TOOL_ROUNDS = 3;

interface RunOptions {
  conversationId: string;
  projectId: string;
  maxToolRounds?: number;
}

export async function runAgentForConversation(
  opts: RunOptions
): Promise<RuntimeRunResult> {
  const { conversationId, projectId } = opts;
  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS;

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, projectId },
    include: {
      contextSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!conv) throw new Error("会话不存在");

  await db.conversation.update({
    where: { id: conversationId },
    data: { runtimeStatus: "running" },
  });

  const snapshot = conv.contextSnapshots[0] ?? null;

  let agentConfig: {
    modelProvider: string;
    modelName: string;
    temperature: number;
    maxTokens: number;
    systemBehaviorNote: string | null;
  } | null = null;

  const toolDefs: ToolDefinition[] = [];
  const toolMap = new Map<string, { id?: string; key: string; name: string; category: string; type: string }>();

  if (conv.agentId) {
    const agent = await db.agent.findFirst({
      where: { id: conv.agentId, projectId },
      include: {
        toolBindings: {
          where: { enabled: true },
          include: {
            tool: { select: { id: true, key: true, name: true, description: true, category: true, type: true, inputSchemaJson: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (agent) {
      agentConfig = {
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        systemBehaviorNote: agent.systemBehaviorNote,
      };

      for (const binding of agent.toolBindings) {
        const t = binding.tool;
        toolMap.set(t.key, { id: t.id, key: t.key, name: t.name, category: t.category, type: t.type });

        let parameters: Record<string, unknown> = { type: "object", properties: {} };
        if (t.inputSchemaJson) {
          try { parameters = JSON.parse(t.inputSchemaJson); } catch { /* use default */ }
        }

        toolDefs.push({
          type: "function",
          function: {
            name: t.key,
            description: t.description ?? t.name,
            parameters,
          },
        });
      }
    }
  }

  let extraConfig: Record<string, unknown> | null = null;
  if (snapshot?.extraConfigJson) {
    try { extraConfig = JSON.parse(snapshot.extraConfigJson); } catch { /* ignore */ }
  }

  const modelProvider = agentConfig?.modelProvider ?? (extraConfig?.modelProvider as string) ?? "openai";
  const modelName = agentConfig?.modelName ?? (extraConfig?.modelName as string) ?? getAIConfig().primaryModel;
  const temperature = agentConfig?.temperature ?? (extraConfig?.temperature as number) ?? 0.7;
  const maxTokens = agentConfig?.maxTokens ?? (extraConfig?.maxTokens as number) ?? 4096;
  const behaviorNote = agentConfig?.systemBehaviorNote ?? (extraConfig?.systemBehaviorNote as string) ?? null;

  const kbId = conv.knowledgeBaseId ?? null;
  const kbContext = await buildKBContext(kbId);

  const systemPrompt = snapshot?.systemPromptSnapshot ?? null;

  const newMessages: RuntimeRunResult["newMessages"] = [];
  const toolTraces: RuntimeRunResult["toolTraces"] = [];

  try {
    const provider = resolveProvider(modelProvider);

    let round = 0;
    let continueLoop = true;

    while (continueLoop && round <= maxRounds) {
      const llmMessages = await buildMessages({
        conversationId,
        systemPromptSnapshot: systemPrompt,
        agentBehaviorNote: behaviorNote,
        kbContext: round === 0 ? kbContext : null,
      });

      const result = await provider.generate({
        model: modelName,
        messages: llmMessages,
        temperature,
        maxTokens,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
      });

      if (result.toolCalls.length > 0) {
        const assistantMsg = await createMessage(conversationId, {
          role: "assistant",
          content: result.assistantText || "",
          modelName: result.modelName,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          finishReason: result.finishReason,
          metadataJson: JSON.stringify({ toolCalls: result.toolCalls, isMock: result.isMock }),
        });
        newMessages.push(assistantMsg);

        for (const tc of result.toolCalls) {
          const toolInfo = toolMap.get(tc.function.name) ?? {
            key: tc.function.name,
            name: tc.function.name,
            category: "unknown",
            type: "unknown",
          };

          const execResult = await executeTool(
            toolInfo,
            tc.function.arguments,
            tc.id,
            { knowledgeBaseId: kbId }
          );

          const trace = await db.toolCallTrace.create({
            data: {
              projectId,
              environmentId: conv.environmentId,
              conversationId,
              messageId: assistantMsg.id,
              agentId: conv.agentId,
              toolId: toolInfo.id ?? null,
              toolKey: execResult.toolKey,
              toolName: execResult.toolName,
              toolCallId: tc.id,
              inputJson: JSON.stringify(execResult.input),
              outputJson: JSON.stringify(execResult.output),
              status: execResult.status,
              errorMessage: execResult.errorMessage ?? null,
              durationMs: execResult.durationMs,
            },
          });
          toolTraces.push({
            id: trace.id,
            toolKey: trace.toolKey,
            toolName: trace.toolName,
            status: trace.status,
            durationMs: trace.durationMs,
          });

          const toolMsg = await createMessage(conversationId, {
            role: "tool",
            content: JSON.stringify(execResult.output),
            toolName: execResult.toolKey,
            toolCallId: tc.id,
            status: execResult.status === "error" ? "error" : "success",
            errorMessage: execResult.errorMessage ?? null,
          });
          newMessages.push(toolMsg);
        }

        round++;
        continue;
      }

      const finalMsg = await createMessage(conversationId, {
        role: "assistant",
        content: result.assistantText,
        modelName: result.modelName,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        finishReason: result.finishReason,
        metadataJson: result.isMock ? JSON.stringify({ isMock: true }) : null,
      });
      newMessages.push(finalMsg);
      continueLoop = false;
    }

    await updateConversationStats(conversationId, newMessages);
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        runtimeStatus: "completed",
        runCount: { increment: 1 },
        lastErrorMessage: null,
      },
    });

    return { newMessages, toolTraces };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    const errorMsg = await createMessage(conversationId, {
      role: "assistant",
      content: "",
      status: "error",
      errorMessage: `Runtime 错误: ${errMsg}`,
      modelName: modelName,
    });
    newMessages.push(errorMsg);

    await updateConversationStats(conversationId, newMessages);
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        runtimeStatus: "failed",
        runCount: { increment: 1 },
        lastErrorMessage: errMsg.slice(0, 500),
      },
    });

    return { newMessages, toolTraces, error: errMsg };
  }
}

async function createMessage(
  conversationId: string,
  data: {
    role: string;
    content: string;
    modelName?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    finishReason?: string | null;
    metadataJson?: string | null;
    toolName?: string | null;
    toolCallId?: string | null;
    status?: string;
    errorMessage?: string | null;
  }
): Promise<RuntimeRunResult["newMessages"][number]> {
  const maxSeq = await db.message.aggregate({
    where: { conversationId },
    _max: { sequence: true },
  });
  const nextSeq = (maxSeq._max.sequence ?? 0) + 1;

  const msg = await db.message.create({
    data: {
      conversationId,
      role: data.role,
      content: data.content,
      contentType: "text",
      sequence: nextSeq,
      modelName: data.modelName ?? null,
      inputTokens: data.inputTokens ?? 0,
      outputTokens: data.outputTokens ?? 0,
      latencyMs: data.latencyMs ?? 0,
      finishReason: data.finishReason ?? null,
      status: data.status ?? "success",
      errorMessage: data.errorMessage ?? null,
      toolName: data.toolName ?? null,
      toolCallId: data.toolCallId ?? null,
      metadataJson: data.metadataJson ?? null,
    },
  });

  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    sequence: msg.sequence,
    modelName: msg.modelName,
    toolName: msg.toolName,
    toolCallId: msg.toolCallId,
    finishReason: msg.finishReason,
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    latencyMs: msg.latencyMs,
    status: msg.status,
  };
}

async function updateConversationStats(
  conversationId: string,
  newMsgs: RuntimeRunResult["newMessages"]
) {
  const addedInput = newMsgs.reduce((s, m) => s + m.inputTokens, 0);
  const addedOutput = newMsgs.reduce((s, m) => s + m.outputTokens, 0);
  const addedCount = newMsgs.length;
  const latencies = newMsgs.filter((m) => m.latencyMs > 0).map((m) => m.latencyMs);
  const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  await db.conversation.update({
    where: { id: conversationId },
    data: {
      messageCount: { increment: addedCount },
      inputTokens: { increment: addedInput },
      outputTokens: { increment: addedOutput },
      totalTokens: { increment: addedInput + addedOutput },
      lastMessageAt: new Date(),
      ...(avgLat > 0 ? { avgLatencyMs: avgLat } : {}),
    },
  });
}
