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
import { recordAiCall, extractUsage } from "@/lib/ai/monitor";
import { registry } from "./tool-registry";
import type {
  AgentRunOptions,
  AgentRunResult,
} from "./types";
import { toolLabel, type AgentStreamEvent } from "./streaming";

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
  externalSignal?: AbortSignal,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const t0 = Date.now();
  const model = params?.model ?? "unknown";
  try {
    const res = await client.chat.completions.create(params, {
      signal: controller.signal,
    });
    const usage = extractUsage(res);
    recordAiCall({
      model,
      success: true,
      elapsedMs: Date.now() - t0,
      source: "agent-core",
      ...usage,
    });
    return res;
  } catch (err: any) {
    const aborted = externalSignal?.aborted || controller.signal.aborted;
    recordAiCall({
      model,
      success: false,
      elapsedMs: Date.now() - t0,
      source: "agent-core",
      error: err instanceof Error ? err.message : String(err),
    });
    if (externalSignal?.aborted) {
      const e = new Error("Client aborted");
      (e as any).name = "AbortError";
      throw e;
    }
    if (err?.name === "AbortError" || aborted) {
      throw new AgentTimeoutError(
        `AI 响应超时（${Math.round(timeoutMs / 1000)}s），请稍后重试`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
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
    role,
  } = options;

  const preset = getTaskPreset(mode);
  const client = getClient();
  const model = preset.model;
  const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;
  const externalSignal = options.abortSignal;

  // 构建可用工具列表（PR1：按角色过滤）
  const openaiTools = registry.toOpenAITools({
    domains: options.domains,
    names: options.tools,
    role,
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
        externalSignal,
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
            role,
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
      externalSignal,
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

// ─────────────────────────────────────────────────────────────
// PR3 — 流式版 runAgent
// ─────────────────────────────────────────────────────────────
//
// 关键行为：
// - 文本增量：每次收到 delta.content 就 yield { type: "text", delta }
// - 工具调用：完成一轮后若需调工具，先 yield tool_start → 执行 → yield tool_result
// - 结束时 yield 一次 done，附带观测指标（firstTokenMs / rounds / toolCalls / latencyMs）
// - OpenAI streaming 下 tool_calls 是按 index 分片传回的，需要跨 chunk 累积

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function* runAgentStream(
  options: AgentRunOptions,
): AsyncGenerator<AgentStreamEvent, void, unknown> {
  const {
    systemPrompt,
    messages: inputMessages,
    userId,
    orgId,
    sessionId,
    mode = "chat",
    temperature,
    maxToolRounds = MAX_TOOL_ROUNDS_DEFAULT,
    role,
    abortSignal,
  } = options;

  const preset = getTaskPreset(mode);
  const client = getClient();
  const model = preset.model;
  const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;
  const startedAt = Date.now();
  let firstTokenMs: number | undefined;
  let toolCallCount = 0;
  let rounds = 0;

  const openaiTools = registry.toOpenAITools({
    domains: options.domains,
    names: options.tools,
    role,
  });

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

  const finish = (): AgentStreamEvent => ({
    type: "done",
    firstTokenMs,
    rounds,
    toolCalls: toolCallCount,
    latencyMs: Date.now() - startedAt,
    model,
  });

  try {
    while (rounds < maxToolRounds) {
      rounds++;

      const remaining = totalDeadline - Date.now();
      if (remaining <= 0) {
        yield { type: "error", message: "AI 处理总时间超限，请稍后重试" };
        return;
      }
      const perRoundMs = Math.min(PER_ROUND_TIMEOUT_MS, remaining);

      const createParams: any = {
        model,
        messages,
        temperature: temperature ?? preset.temperature,
        max_completion_tokens: preset.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (openaiTools.length > 0) {
        createParams.tools = openaiTools;
      }

      // 超时 + 外部 abort 合并为一个 controller
      const controller = new AbortController();
      const perRoundTimer = setTimeout(() => controller.abort(), perRoundMs);
      const onExternalAbort = () => controller.abort();
      if (abortSignal) {
        if (abortSignal.aborted) controller.abort();
        else abortSignal.addEventListener("abort", onExternalAbort, { once: true });
      }

      const t0 = Date.now();
      let streamIter: any;
      try {
        streamIter = await client.chat.completions.create(createParams, {
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(perRoundTimer);
        if (abortSignal) abortSignal.removeEventListener("abort", onExternalAbort);
        if (abortSignal?.aborted) {
          yield { type: "error", message: "客户端已断开" };
          return;
        }
        if (err?.name === "AbortError" || controller.signal.aborted) {
          yield {
            type: "error",
            message: `AI 响应超时（${Math.round(perRoundMs / 1000)}s），请稍后重试`,
          };
          return;
        }
        yield { type: "error", message: err?.message || "AI 调用失败" };
        return;
      }

      // 一轮流式解析 —— 累积文本 + tool_calls
      let accText = "";
      const accToolCalls: Record<number, {
        id: string;
        function: { name: string; arguments: string };
      }> = {};
      let finishReason: string | null = null;
      let lastChunk: any = null;
      let streamErr: any = null;

      try {
        for await (const chunk of streamIter) {
          lastChunk = chunk;
          const choice = chunk?.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta?.content) {
            if (firstTokenMs === undefined) {
              firstTokenMs = Date.now() - startedAt;
            }
            accText += delta.content;
            yield { type: "text", delta: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              if (!accToolCalls[idx]) {
                accToolCalls[idx] = {
                  id: tc.id ?? "",
                  function: { name: "", arguments: "" },
                };
              }
              const acc = accToolCalls[idx];
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.function.name += tc.function.name;
              if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }

        const usage = extractUsage(lastChunk);
        recordAiCall({
          model,
          success: true,
          elapsedMs: Date.now() - t0,
          source: "agent-core-stream",
          ...usage,
        });
      } catch (err: any) {
        streamErr = err;
        recordAiCall({
          model,
          success: false,
          elapsedMs: Date.now() - t0,
          source: "agent-core-stream",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearTimeout(perRoundTimer);
        if (abortSignal) abortSignal.removeEventListener("abort", onExternalAbort);
      }

      if (streamErr) {
        if (abortSignal?.aborted) {
          yield { type: "error", message: "客户端已断开" };
          return;
        }
        yield {
          type: "error",
          message: streamErr?.message || "流式响应中断",
        };
        return;
      }

      const pendingToolCalls = Object.values(accToolCalls).filter(
        (tc) => tc.function.name,
      );

      // 若本轮没有工具调用 → 已是最终回复
      if (pendingToolCalls.length === 0 || finishReason === "stop") {
        yield finish();
        return;
      }

      // 有工具调用 —— 把 assistant 消息（含 tool_calls）推进去
      messages.push({
        role: "assistant",
        content: accText || null,
        tool_calls: pendingToolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || "{}",
          },
        })),
      });

      // 逐个执行工具：start → execute → result → 回填 tool 消息
      for (const tc of pendingToolCalls) {
        toolCallCount++;
        const name = tc.function.name;
        yield { type: "tool_start", name, label: toolLabel(name) };

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await registry.execute(name, {
          args,
          userId,
          orgId,
          sessionId,
          role,
        });

        yield { type: "tool_result", name, ok: result.success };

        messages.push({
          role: "tool",
          content: JSON.stringify(result.data),
          tool_call_id: tc.id,
          name,
        });
      }
      // 进入下一轮让 LLM 基于工具结果继续生成
    }

    // 达到最大轮次 —— 做一次非流式的总结兜底，不让用户一句话也拿不到
    const finalRemaining = totalDeadline - Date.now();
    try {
      const finalRes: any = await client.chat.completions.create(
        {
          model,
          messages: [
            ...messages,
            { role: "user", content: "请基于以上工具返回的数据，给出最终回复。" },
          ],
          temperature: temperature ?? preset.temperature,
          max_completion_tokens: preset.maxTokens,
          stream: true,
        },
        { signal: abortSignal },
      );
      for await (const chunk of finalRes) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) {
          if (firstTokenMs === undefined) firstTokenMs = Date.now() - startedAt;
          yield { type: "text", delta };
        }
      }
    } catch (err: any) {
      if (finalRemaining > 0) {
        yield {
          type: "error",
          message: err?.message || "最终总结失败",
        };
        return;
      }
    }

    yield finish();
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
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
