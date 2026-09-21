/**
 * Responses API 适配器 — 仅 GPT-6 Astra + tools 使用。
 * 输出 Chat Completions 兼容形状，避免重写 Agent Core 循环。
 */

import { getClient } from "./client";
import { isGpt6Astra, requiresResponsesApi } from "./model-policy/compat";
import { sanitizeReasoningEffort } from "./model-policy/compat";
import { capToolResultPayload } from "./model-policy/guardrails";
import type { ExtendedReasoningEffort } from "./model-policy/reasoning";

export { requiresResponsesApi, isGpt6Astra };

type ChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

type ChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

export type ChatCompatResponse = {
  id?: string;
  model: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string | null;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function extractInstructions(messages: ChatMessage[]): string | undefined {
  const sys = messages.filter(
    (m) => m.role === "system" || m.role === "developer",
  );
  if (sys.length === 0) return undefined;
  return sys.map((m) => asText(m.content)).join("\n\n");
}

function toResponsesInput(messages: ChatMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") continue;
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id || m.name || "tool",
        output: capToolResultPayload(m.content),
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        });
      }
      const text = asText(m.content).trim();
      if (text) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      continue;
    }
    input.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: asText(m.content),
    });
  }
  return input;
}

function toResponsesTools(tools: ChatTool[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

export function mapResponsesToChatCompat(res: {
  id?: string;
  model?: string;
  output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}): ChatCompatResponse {
  const output = Array.isArray(res.output) ? res.output : [];
  let text = "";
  const toolCalls: NonNullable<ChatCompatResponse["choices"][0]["message"]["tool_calls"]> =
    [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (row.type === "function_call" && row.name) {
      toolCalls.push({
        id: row.call_id || `call_${toolCalls.length}`,
        type: "function",
        function: {
          name: row.name,
          arguments: row.arguments || "{}",
        },
      });
    }
    if (row.type === "message" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (part?.type === "output_text" && part.text) text += part.text;
      }
    }
  }

  return {
    id: res.id,
    model: res.model || "",
    choices: [
      {
        message: {
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: res.usage?.input_tokens,
      completion_tokens: res.usage?.output_tokens,
      total_tokens: res.usage?.total_tokens,
      prompt_tokens_details: {
        cached_tokens: res.usage?.input_tokens_details?.cached_tokens,
      },
    },
  };
}

export async function createResponsesAsChatCompat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  maxOutputTokens: number;
  reasoningEffort: string;
  signal?: AbortSignal;
}): Promise<ChatCompatResponse> {
  const client = getClient();
  const effort = sanitizeReasoningEffort({
    model: opts.model,
    effort: opts.reasoningEffort,
    hasFunctionTools: Boolean(opts.tools?.length),
  }) as ExtendedReasoningEffort;
  const body = {
    model: opts.model,
    instructions: extractInstructions(opts.messages),
    input: toResponsesInput(opts.messages),
    max_output_tokens: opts.maxOutputTokens,
    reasoning: { effort },
    tools: toResponsesTools(opts.tools),
    store: false,
  };
  const res = await client.responses.create(
    body as never,
    opts.signal ? { signal: opts.signal } : undefined,
  );
  return mapResponsesToChatCompat(res as never);
}

/** 把一次完整 Responses 结果伪装成 Chat Completions stream，供现有解析循环使用 */
export async function* chatCompatToStream(
  compat: ChatCompatResponse,
): AsyncGenerator<ChatCompatResponse, void, unknown> {
  const msg = compat.choices[0]?.message;
  if (msg?.content) {
    yield {
      ...compat,
      choices: [
        {
          message: msg,
          finish_reason: null,
          delta: { content: msg.content },
        },
      ],
      usage: undefined,
    };
  }
  if (msg?.tool_calls?.length) {
    yield {
      ...compat,
      choices: [
        {
          message: msg,
          finish_reason: null,
          delta: {
            tool_calls: msg.tool_calls.map((tc, index) => ({
              index,
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          },
        },
      ],
      usage: undefined,
    };
  }
  yield {
    ...compat,
    choices: [
      {
        message: msg ?? { role: "assistant", content: null },
        finish_reason: msg?.tool_calls?.length ? "tool_calls" : "stop",
        delta: {},
      },
    ],
  };
}

export async function createModelTurn(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  maxCompletionTokens: number;
  temperature: number;
  reasoningEffort: string;
  stream?: boolean;
  signal?: AbortSignal;
  extra?: Record<string, unknown>;
}): Promise<ChatCompatResponse | AsyncIterable<ChatCompatResponse>> {
  const { buildTuningParams } = await import("./client");
  const hasTools = Boolean(opts.tools?.length);
  if (requiresResponsesApi(opts.model, hasTools)) {
    const compat = await createResponsesAsChatCompat({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      maxOutputTokens: opts.maxCompletionTokens,
      reasoningEffort: opts.reasoningEffort,
      signal: opts.signal,
    });
    if (opts.stream) return chatCompatToStream(compat);
    return compat;
  }

  const client = getClient();
  const params = {
    model: opts.model,
    messages: opts.messages,
    max_completion_tokens: opts.maxCompletionTokens,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(opts.stream
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
    ...buildTuningParams(
      opts.model,
      opts.temperature,
      opts.reasoningEffort as "low" | "medium" | "high",
      { hasFunctionTools: hasTools },
    ),
    ...opts.extra,
  };
  return client.chat.completions.create(
    params as never,
    opts.signal ? { signal: opts.signal } : undefined,
  ) as Promise<ChatCompatResponse | AsyncIterable<ChatCompatResponse>>;
}
