/**
 * Provider Router — 业务代码获取模型的唯一入口
 *
 * 本轮仅启用 OpenAI；其余 Provider 接口预留，调用时明确报错。
 */

import type { AiProviderId } from "./types";
import { OpenAIModels } from "./openai";

function assertOpenAI(provider: AiProviderId | undefined): void {
  const p = provider ?? "openai";
  if (p !== "openai" && p !== "azure-openai") {
    throw new Error(
      `Provider "${p}" 尚未接入。本轮仅支持 openai（预留: gemini/anthropic/qwen/comfyui/azure-openai）`,
    );
  }
}

export const ProviderRouter = {
  /** 当前默认 Provider */
  defaultProvider: "openai" as AiProviderId,

  getChatModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.chat;
  },

  getReasoningModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.reasoning;
  },

  getImageModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.image;
  },

  getImagePinnedModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.imagePinned;
  },

  getVisionModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.vision;
  },

  getFastModel(provider?: AiProviderId): string {
    assertOpenAI(provider);
    return OpenAIModels.fast;
  },

  /** 未来多 Provider 时扩展 */
  listSupportedProviders(): AiProviderId[] {
    return ["openai"];
  },
} as const;
