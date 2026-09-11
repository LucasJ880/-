import OpenAI from "openai";
import type { LLMProvider } from "./provider";
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  ToolCallRequest,
} from "./types";
import { getClient, buildTuningParams } from "@/lib/ai/client";
import { getAIConfig } from "@/lib/ai/config";
import {
  createResponsesAsChatCompat,
  requiresResponsesApi,
} from "@/lib/ai/responses-client";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  private client: OpenAI;

  constructor() {
    this.client = getClient();
  }

  async generate(req: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const start = Date.now();
    const cfg = getAIConfig();

    const model = req.model || cfg.primaryModel;
    const hasFunctionTools = Boolean(req.tools?.length);

    if (requiresResponsesApi(model, hasFunctionTools)) {
      const mappedTools = req.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters as Record<string, unknown>,
        },
      }));
      const compat = await createResponsesAsChatCompat({
        model,
        messages: req.messages,
        tools: mappedTools,
        maxOutputTokens: req.maxTokens ?? 4096,
        reasoningEffort: "medium",
      });
      const choice = compat.choices[0];
      const usage = compat.usage;
      const toolCalls: ToolCallRequest[] = (choice?.message?.tool_calls ?? []).map(
        (tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }),
      );
      return {
        assistantText: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? "stop",
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        latencyMs: Date.now() - start,
        modelName: compat.model || model,
        toolCalls,
        isMock: false,
      };
    }

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: req.messages.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool" as const,
            content: m.content,
            tool_call_id: m.tool_call_id ?? "",
          };
        }
        return { role: m.role, content: m.content };
      }),
      max_completion_tokens: req.maxTokens ?? 4096,
      ...(buildTuningParams(model, req.temperature ?? 0.7, "medium", {
        hasFunctionTools,
      }) as { temperature?: number; reasoning_effort?: "none" | "low" | "medium" | "high" }),
    };

    if (hasFunctionTools && req.tools) {
      params.tools = req.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters as Record<string, unknown>,
        },
      }));
    }

    const response = await this.client.chat.completions.create(params);

    const latencyMs = Date.now() - start;
    const choice = response.choices[0];
    const usage = response.usage;

    const toolCalls: ToolCallRequest[] = (choice?.message?.tool_calls ?? [])
      .filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      assistantText: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? "stop",
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      latencyMs,
      modelName: response.model ?? req.model,
      toolCalls,
      isMock: false,
    };
  }
}
