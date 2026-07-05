/**
 * 项目会话 Adapter（A-P1）— 项目会话链路收敛到 agent-core runAgent
 *
 * 取代 lib/runtime/agent-runtime.ts 的 runAgentForConversation，保留其对外语义：
 * - 输入输出结构不变（RuntimeRunResult 同构）
 * - Message（sequence 递增）/ Conversation 统计 / runtimeStatus / ToolCallTrace 持久化语义保留
 * - ConversationContextSnapshot 的 systemPromptSnapshot + Agent behaviorNote + KB 上下文注入
 * - 无 OPENAI_API_KEY 或 Agent 指定 mock provider 时走 adapter 层 mock（原 MockProvider 语义）
 *
 * 与旧 runtime 的差异（有意为之）：
 * - 多轮工具循环由 agent-core engine 驱动；持久化时序为「tool 消息 × N → 最终 assistant 消息」，
 *   工具调用明细同时存 assistant 消息 metadataJson.toolCalls 与 ToolCallTrace。
 * - token 数为估算值（原 usage 精确值不再逐轮透出）；metadataJson.tokenEstimated=true 标注。
 */

import { db } from "@/lib/db";
import { runAgent } from "../engine";
import { buildKBContext } from "./kb-context";
import type { CoreMessage, ToolDefinition, ToolParameterSchema } from "../types";
import { persistToolCallTraces } from "../observability";

const MAX_TOOL_ROUNDS = 3;

export interface ConversationRunResult {
  newMessages: {
    id: string;
    role: string;
    content: string;
    sequence: number;
    modelName?: string | null;
    toolName?: string | null;
    toolCallId?: string | null;
    finishReason?: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    status: string;
  }[];
  toolTraces: {
    id: string;
    toolKey: string;
    toolName: string;
    status: string;
    durationMs: number;
  }[];
  error?: string;
}

interface RunOptions {
  conversationId: string;
  projectId: string;
  maxToolRounds?: number;
  /** 触发运行的用户（工具执行上下文用；缺省回退会话创建者） */
  userId?: string;
}

interface BoundTool {
  id?: string;
  key: string;
  name: string;
  category: string;
  type: string;
  description: string | null;
  inputSchemaJson: string | null;
}

export async function runConversationAgent(opts: RunOptions): Promise<ConversationRunResult> {
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

  // ── Agent 配置 + 工具绑定（沿用旧 runtime 的解析优先级）──────
  let agentConfig: {
    modelProvider: string;
    temperature: number;
    systemBehaviorNote: string | null;
  } | null = null;
  const boundTools: BoundTool[] = [];

  if (conv.agentId) {
    const agent = await db.agent.findFirst({
      where: { id: conv.agentId, projectId },
      include: {
        toolBindings: {
          where: { enabled: true },
          include: {
            tool: {
              select: {
                id: true, key: true, name: true, description: true,
                category: true, type: true, inputSchemaJson: true,
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (agent) {
      agentConfig = {
        modelProvider: agent.modelProvider,
        temperature: agent.temperature,
        systemBehaviorNote: agent.systemBehaviorNote,
      };
      for (const b of agent.toolBindings) {
        boundTools.push({ ...b.tool });
      }
    }
  }

  let extraConfig: Record<string, unknown> | null = null;
  if (snapshot?.extraConfigJson) {
    try { extraConfig = JSON.parse(snapshot.extraConfigJson); } catch { /* ignore */ }
  }

  const modelProvider =
    agentConfig?.modelProvider ?? (extraConfig?.modelProvider as string) ?? "openai";
  const temperature =
    agentConfig?.temperature ?? (extraConfig?.temperature as number) ?? 0.7;
  const behaviorNote =
    agentConfig?.systemBehaviorNote ?? (extraConfig?.systemBehaviorNote as string) ?? null;

  const kbId = conv.knowledgeBaseId ?? null;
  const kbContext = await buildKBContext(kbId);

  const systemParts: string[] = [];
  if (snapshot?.systemPromptSnapshot) systemParts.push(snapshot.systemPromptSnapshot);
  if (behaviorNote) systemParts.push(behaviorNote);
  if (kbContext) {
    systemParts.push("以下是来自知识库的参考内容，请在回答时优先参考：\n\n" + kbContext);
  }
  const systemPrompt = systemParts.join("\n\n") || "你是青砚项目会话助手，请基于对话历史回答。";

  const history = await loadHistory(conversationId);

  const newMessages: ConversationRunResult["newMessages"] = [];
  const toolTraces: ConversationRunResult["toolTraces"] = [];
  const startedAt = Date.now();

  try {
    // ── mock 路径（保留旧 MockProvider 开发语义）────────────
    if (modelProvider === "mock" || !process.env.OPENAI_API_KEY) {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const mockText = `[Mock] 收到消息「${(lastUser?.content ?? "").slice(0, 50)}」。这是模拟回复，因为当前未配置有效的 LLM API Key。`;
      const msg = await createMessage(conversationId, {
        role: "assistant",
        content: mockText,
        modelName: "mock",
        latencyMs: Date.now() - startedAt,
        finishReason: "stop",
        metadataJson: JSON.stringify({ isMock: true }),
      });
      newMessages.push(msg);
      await finalizeConversation(conversationId, newMessages, null);
      return { newMessages, toolTraces };
    }

    // ── 真实路径：agent-core runAgent + run 级 DB 动态工具 ──
    const toolDurations: number[] = [];
    const extraTools: ToolDefinition[] = boundTools.map((t) => {
      let parameters: ToolParameterSchema = { type: "object", properties: {} };
      if (t.inputSchemaJson) {
        try { parameters = JSON.parse(t.inputSchemaJson) as ToolParameterSchema; } catch { /* default */ }
      }
      return {
        name: t.key,
        description: t.description ?? t.name,
        domain: "project",
        parameters,
        risk: "l0_read",
        allowRoles: "*",
        execute: async (ctx) => {
          const output = await executeBuiltinBoundTool(t, ctx.args, { knowledgeBaseId: kbId });
          return { success: output.status !== "error", data: output.output, error: output.errorMessage };
        },
      };
    });

    const result = await runAgent({
      systemPrompt,
      messages: history,
      userId: opts.userId ?? conv.userId ?? "system",
      orgId: "project-conversation",
      sessionId: conversationId,
      mode: "chat",
      temperature,
      maxToolRounds: maxRounds,
      // 仅暴露会话绑定的 DB 工具（不放开全局 registry 工具，行为与旧 runtime 对齐）
      tools: ["__conversation_bound_only__"],
      extraTools,
      hooks: {
        onToolCall: (info) => {
          toolDurations.push(info.durationMs);
        },
      },
    });

    // 持久化 tool 消息（时间线语义）
    for (const tc of result.toolCalls) {
      const toolMsg = await createMessage(conversationId, {
        role: "tool",
        content: JSON.stringify(tc.result.data ?? null),
        toolName: tc.name,
        status: tc.result.success ? "success" : "error",
        errorMessage: tc.result.success ? null : (tc.result.error ?? null),
      });
      newMessages.push(toolMsg);
    }

    // 最终 assistant 消息（token 估算，见文件头说明）
    const outputTokens = Math.ceil(result.content.length / 4);
    const inputTokens = Math.ceil(JSON.stringify(history).length / 4);
    const finalMsg = await createMessage(conversationId, {
      role: "assistant",
      content: result.content,
      modelName: result.model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - startedAt,
      finishReason: "stop",
      metadataJson: JSON.stringify({
        tokenEstimated: true,
        rounds: result.rounds,
        toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, success: tc.result.success })),
      }),
    });
    newMessages.push(finalMsg);

    // ToolCallTrace（挂在最终 assistant 消息上）
    if (result.toolCalls.length > 0) {
      await persistToolCallTraces({
        projectId,
        environmentId: conv.environmentId,
        conversationId,
        messageId: finalMsg.id,
        agentId: conv.agentId,
        toolCalls: result.toolCalls,
        durationsMs: toolDurations,
      });
      const traces = await db.toolCallTrace.findMany({
        where: { messageId: finalMsg.id },
        select: { id: true, toolKey: true, toolName: true, status: true, durationMs: true },
        orderBy: { createdAt: "asc" },
      });
      toolTraces.push(...traces);
    }

    await finalizeConversation(conversationId, newMessages, null);
    return { newMessages, toolTraces };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    const errorMsg = await createMessage(conversationId, {
      role: "assistant",
      content: "",
      status: "error",
      errorMessage: `Runtime 错误: ${errMsg}`,
    });
    newMessages.push(errorMsg);

    await finalizeConversation(conversationId, newMessages, errMsg);
    return { newMessages, toolTraces, error: errMsg };
  }
}

// ── DB 绑定工具执行（原 lib/runtime/tool-executor 的 builtin 语义）──

async function executeBuiltinBoundTool(
  tool: BoundTool,
  args: Record<string, unknown>,
  context: { knowledgeBaseId?: string | null },
): Promise<{ output: unknown; status: "success" | "error" | "skipped"; errorMessage?: string }> {
  try {
    if (tool.category !== "builtin" && tool.type !== "builtin") {
      return {
        output: { message: `工具类型 '${tool.type}' (${tool.category}) 暂不支持执行` },
        status: "skipped",
      };
    }
    switch (tool.key) {
      case "echo":
        return { output: { echo: args }, status: "success" };
      case "calculator": {
        const expr = String(args.expression ?? args.input ?? "");
        return { output: { result: safeCalculate(expr), expression: expr }, status: "success" };
      }
      case "kb_lookup": {
        const query = String(args.query ?? args.input ?? "");
        return { output: await kbLookup(query, context.knowledgeBaseId ?? null), status: "success" };
      }
      default:
        return { output: { message: `未知的内置工具: ${tool.key}` }, status: "success" };
    }
  } catch (err) {
    return {
      output: null,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeCalculate(expr: string): string {
  const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, "");
  if (!sanitized || sanitized.length > 100) return "无效表达式";
  try {
    const fn = new Function(`"use strict"; return (${sanitized})`);
    const result = fn();
    if (typeof result !== "number" || !isFinite(result)) return "计算结果无效";
    return String(result);
  } catch {
    return "计算错误";
  }
}

async function kbLookup(query: string, knowledgeBaseId: string | null): Promise<unknown> {
  if (!knowledgeBaseId || !query.trim()) {
    return { results: [], message: "未绑定知识库或查询为空" };
  }
  const docs = await db.knowledgeDocument.findMany({
    where: {
      knowledgeBaseId,
      status: "active",
      title: { contains: query.slice(0, 50), mode: "insensitive" },
    },
    take: 3,
    select: { title: true, id: true },
  });
  if (docs.length === 0) {
    const fallback = await db.knowledgeDocument.findMany({
      where: { knowledgeBaseId, status: "active" },
      take: 3,
      select: { title: true, id: true },
    });
    return {
      results: fallback.map((d) => ({ title: d.title })),
      message: `未精确匹配「${query}」，返回最近文档`,
    };
  }
  return { results: docs.map((d) => ({ title: d.title })) };
}

// ── 历史 / 消息持久化 / 会话统计（与旧 runtime 语义一致）─────────

async function loadHistory(conversationId: string): Promise<CoreMessage[]> {
  const history = await db.message.findMany({
    where: { conversationId },
    orderBy: { sequence: "asc" },
    take: 50,
    select: { role: true, content: true, toolName: true, toolCallId: true },
  });

  const messages: CoreMessage[] = [];
  for (const msg of history) {
    // tool 消息缺 assistant tool_calls 配对时不能直接回放给 OpenAI，降级为 user 备注
    if (msg.role === "tool") {
      messages.push({
        role: "user",
        content: `[工具 ${msg.toolName ?? "unknown"} 返回] ${msg.content}`.slice(0, 4000),
      });
      continue;
    }
    const role = msg.role === "assistant" || msg.role === "system" ? msg.role : "user";
    if (role === "system") continue; // system 由 snapshot 统一注入，避免重复
    messages.push({ role, content: msg.content });
  }
  return messages;
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
  },
): Promise<ConversationRunResult["newMessages"][number]> {
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

async function finalizeConversation(
  conversationId: string,
  newMsgs: ConversationRunResult["newMessages"],
  errMsg: string | null,
): Promise<void> {
  const addedInput = newMsgs.reduce((s, m) => s + m.inputTokens, 0);
  const addedOutput = newMsgs.reduce((s, m) => s + m.outputTokens, 0);
  const latencies = newMsgs.filter((m) => m.latencyMs > 0).map((m) => m.latencyMs);
  const avgLat =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

  await db.conversation.update({
    where: { id: conversationId },
    data: {
      messageCount: { increment: newMsgs.length },
      inputTokens: { increment: addedInput },
      outputTokens: { increment: addedOutput },
      totalTokens: { increment: addedInput + addedOutput },
      lastMessageAt: new Date(),
      ...(avgLat > 0 ? { avgLatencyMs: avgLat } : {}),
      runtimeStatus: errMsg ? "failed" : "completed",
      runCount: { increment: 1 },
      lastErrorMessage: errMsg ? errMsg.slice(0, 500) : null,
    },
  });
}
