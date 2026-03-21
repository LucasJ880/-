import type { LLMProvider } from "./provider";
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  ToolCallRequest,
} from "./types";

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async generate(req: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";

    const hasTools = req.tools && req.tools.length > 0;
    const toolCalls: ToolCallRequest[] = [];

    if (hasTools && userText.includes("工具") || hasTools && userText.includes("tool")) {
      const firstTool = req.tools![0];
      toolCalls.push({
        id: `mock_tc_${Date.now()}`,
        type: "function",
        function: {
          name: firstTool.function.name,
          arguments: JSON.stringify({ input: userText }),
        },
      });
    }

    const latencyMs = Date.now() - start;
    const inputTokens = Math.ceil(JSON.stringify(req.messages).length / 4);
    const mockReply = toolCalls.length > 0
      ? ""
      : `[Mock] 收到消息「${userText.slice(0, 50)}」。这是模拟回复，因为当前未配置有效的 LLM API Key。模型: ${req.model}`;

    return {
      assistantText: mockReply,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        inputTokens,
        outputTokens: Math.ceil(mockReply.length / 4),
        totalTokens: inputTokens + Math.ceil(mockReply.length / 4),
      },
      latencyMs,
      modelName: `mock-${req.model}`,
      toolCalls,
      isMock: true,
    };
  }
}
