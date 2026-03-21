import type { LLMGenerateRequest, LLMGenerateResult } from "./types";

export interface LLMProvider {
  readonly name: string;
  generate(req: LLMGenerateRequest): Promise<LLMGenerateResult>;
}

import { OpenAIProvider } from "./openai-provider";
import { MockProvider } from "./mock-provider";

export function resolveProvider(providerName: string): LLMProvider {
  switch (providerName) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) return new MockProvider();
      return new OpenAIProvider();
    case "mock":
      return new MockProvider();
    default:
      return new MockProvider();
  }
}
