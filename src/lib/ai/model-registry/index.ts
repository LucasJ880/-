/**
 * Model Registry + Provider Router
 *
 * 业务代码规则：
 * - 禁止写死 gpt-5.6-sol / gpt-5.6-terra / gpt-image-2
 * - 聊天：ProviderRouter.getChatModel() 或 ModelRegistry.chat
 * - 推理：ProviderRouter.getReasoningModel() 或 ModelRegistry.reasoning
 * - 图片：ProviderRouter.getImageModel() 或 ModelRegistry.image
 *
 * 未来演进：AiCapabilityRegistry（Chat/Vision/Speech/Embedding…）
 */

import { OpenAIModels, OPENAI_BUILTIN } from "./openai";
import { ProviderRouter } from "./provider-router";
import { RETIRED_MODEL_PATTERNS } from "./types";

export { OpenAIModels, OPENAI_BUILTIN } from "./openai";
export { ProviderRouter } from "./provider-router";
export type { AiProviderId, AiCapabilityKind, ProviderModelBundle } from "./types";
export { RETIRED_MODEL_PATTERNS } from "./types";

/**
 * 统一模型注册表（字符串属性，运行时解析 env）
 */
export const ModelRegistry = {
  get chat(): string {
    return OpenAIModels.chat;
  },
  get reasoning(): string {
    return OpenAIModels.reasoning;
  },
  get image(): string {
    return OpenAIModels.image;
  },
  get imagePinned(): string {
    return OpenAIModels.imagePinned;
  },
  /** 可选业务覆盖；未设置时等于 image */
  get productContentImage(): string {
    return OpenAIModels.productContent;
  },
  /** 结构化访问（兼容文档中的 .default / .pinned） */
  get imageModels() {
    return {
      default: OpenAIModels.image,
      pinned: OpenAIModels.imagePinned,
      productContent: OpenAIModels.productContent,
    };
  },
  get vision(): string {
    return OpenAIModels.vision;
  },
  get fast(): string {
    return OpenAIModels.fast;
  },
} as const;

/**
 * AI Capability Registry（前瞻接口）
 * 本轮能力仍映射到 Model；后续可挂 Speech / Embedding / OCR 等。
 */
export const AiCapabilityRegistry = {
  chat: () => ProviderRouter.getChatModel(),
  reasoning: () => ProviderRouter.getReasoningModel(),
  vision: () => ProviderRouter.getVisionModel(),
  image: () => ProviderRouter.getImageModel(),
  speech: (): string => {
    throw new Error("Speech capability 尚未接入 Capability Registry");
  },
  embedding: (): string => {
    throw new Error("Embedding capability 尚未接入 Capability Registry");
  },
  translation: (): string => {
    throw new Error("Translation capability 尚未接入 Capability Registry");
  },
  ocr: (): string => {
    throw new Error("OCR capability 尚未接入 Capability Registry");
  },
} as const;

export function getModelRegistrySnapshot() {
  return {
    chat: ModelRegistry.chat,
    reasoning: ModelRegistry.reasoning,
    fast: ModelRegistry.fast,
    image: ModelRegistry.image,
    imagePinned: ModelRegistry.imagePinned,
    productContentImage: ModelRegistry.productContentImage,
    vision: ModelRegistry.vision,
    preferredChatModel: ProviderRouter.getChatModel(),
    preferredReasoningModel: ProviderRouter.getReasoningModel(),
    preferredImageModel: ProviderRouter.getImageModel(),
    preferredProductContentImageModel:
      ProviderRouter.getProductContentImageModel(),
    provider: ProviderRouter.defaultProvider,
    builtins: { ...OPENAI_BUILTIN },
  };
}

export function listRetiredModelsInUse(values: string[]): string[] {
  const hit: string[] = [];
  for (const v of values) {
    for (const retired of RETIRED_MODEL_PATTERNS) {
      if (
        v === retired ||
        v.startsWith(`${retired}-`) ||
        v.startsWith(`${retired}_`)
      ) {
        hit.push(v);
      }
    }
  }
  return [...new Set(hit)];
}
