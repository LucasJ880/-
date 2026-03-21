export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallRequest {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMGenerateRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface LLMGenerateResult {
  assistantText: string;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  modelName: string;
  toolCalls: ToolCallRequest[];
  isMock: boolean;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolKey: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  status: "success" | "error" | "skipped";
  errorMessage?: string;
  durationMs: number;
}

export interface RuntimeRunResult {
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
