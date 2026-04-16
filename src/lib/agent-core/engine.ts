/**
 * Agent Core Engine — 统一 AI 调度引擎
 *
 * 基于 OpenAI function calling 的多轮工具调度：
 * 1. 将注册表中的工具转换为 OpenAI tools 格式
 * 2. LLM 决定是否调用工具
 * 3. 自动执行工具并回填结果
 * 4. 循环直到 LLM 给出最终回复（或达到最大轮数）
 *
 * 兼容性设计：
 * - 支持 OpenAI 原生 function calling（默认）
 * - 对不支持 function calling 的模型，自动降级为文本伪协议
 */

import { getClient } from "@/lib/ai/client";
import { getTaskPreset } from "@/lib/ai/config";
import { registry } from "./tool-registry";
import type {
  AgentRunOptions,
  AgentRunResult,
} from "./types";

// 确保工具已注册
import "./tools";

const MAX_TOOL_ROUNDS_DEFAULT = 5;
const PER_ROUND_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 90_000;

/* eslint-disable @typescript-eslint/no-explicit-any */

class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

async function llmCallWithTimeout(
  client: ReturnType<typeof getClient>,
  params: any,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.chat.completions.create(params, {
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      throw new AgentTimeoutError(
        `AI 响应超时（${Math.round(timeoutMs / 1000)}s），请稍后重试`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const {
    systemPrompt,
    messages: inputMessages,
    userId,
    orgId,
    sessionId,
    mode = "chat",
    temperature,
    maxToolRounds = MAX_TOOL_ROUNDS_DEFAULT,
  } = options;

  const preset = getTaskPreset(mode);
  const client = getClient();
  const model = preset.model;
  const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;

  // 构建可用工具列表
  const openaiTools = registry.toOpenAITools({
    domains: options.domains,
    names: options.tools,
  });

  // 构建初始消息（使用 any 绕过 SDK 严格类型）
  const messages: any[] = [
    { role: "developer", content: systemPrompt },
    ...inputMessages.map((m) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      return msg;
    }),
  ];

  const toolCallLog: AgentRunResult["toolCalls"] = [];
  let rounds = 0;

  try {
    while (rounds < maxToolRounds) {
      rounds++;

      const remaining = totalDeadline - Date.now();
      if (remaining <= 0) {
        throw new AgentTimeoutError("AI 处理总时间超限，请稍后重试");
      }

      const createParams: any = {
        model,
        messages,
        temperature: temperature ?? preset.temperature,
        max_completion_tokens: preset.maxTokens,
      };
      if (openaiTools.length > 0) {
        createParams.tools = openaiTools;
      }

      const response = await llmCallWithTimeout(
        client,
        createParams,
        Math.min(PER_ROUND_TIMEOUT_MS, remaining),
      );

      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage: any = choice.message;

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          content: assistantMessage.content ?? "",
          toolCalls: toolCallLog,
          model,
          rounds,
        };
      }

      messages.push({
        role: "assistant",
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      const toolResults = await Promise.all(
        assistantMessage.tool_calls.map(async (tc: any) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

          const result = await registry.execute(tc.function.name, {
            args,
            userId,
            orgId,
            sessionId,
          });

          toolCallLog.push({
            name: tc.function.name,
            args,
            result,
          });

          return { id: tc.id, name: tc.function.name, result };
        }),
      );

      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: JSON.stringify(tr.result.data),
          tool_call_id: tr.id,
          name: tr.name,
        });
      }
    }

    // 超过最大轮数，做一次最终总结
    const remaining = totalDeadline - Date.now();
    const finalResponse = await llmCallWithTimeout(
      client,
      {
        model,
        messages: [
          ...messages,
          { role: "user", content: "请基于以上工具返回的数据，给出最终回复。" },
        ],
        temperature: temperature ?? preset.temperature,
        max_completion_tokens: preset.maxTokens,
      },
      Math.max(remaining, 5000),
    );

    return {
      content: (finalResponse.choices[0]?.message as any)?.content ?? "",
      toolCalls: toolCallLog,
      model,
      rounds,
    };
  } catch (err) {
    if (err instanceof AgentTimeoutError) {
      return {
        content: err.message,
        toolCalls: toolCallLog,
        model,
        rounds,
      };
    }
    throw err;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 简化版：单轮对话（无工具）
 * 兼容现有 createCompletion 的使用场景
 */
export async function runSimple(options: {
  systemPrompt: string;
  userPrompt: string;
  mode?: string;
  temperature?: number;
}): Promise<string> {
  const result = await runAgent({
    systemPrompt: options.systemPrompt,
    messages: [{ role: "user", content: options.userPrompt }],
    mode: (options.mode as AgentRunOptions["mode"]) ?? "chat",
    temperature: options.temperature,
    userId: "system",
    orgId: "default",
  });
  return result.content;
}
