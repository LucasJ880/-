import OpenAI from "openai";
import type { LLMProvider } from "./provider";
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  ToolCallRequest,
} from "./types";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }

  async generate(req: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const start = Date.now();

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: req.model || process.env.OPENAI_MODEL || "gpt-4o",
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
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };

    if (req.tools && req.tools.length > 0) {
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
