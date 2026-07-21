/**
 * AI Capability / Provider 类型（为 Capability Registry 预留）
 *
 * 本轮实现：OpenAI。
 * 接口已预留：Gemini / Anthropic / Qwen / ComfyUI / Azure OpenAI。
 */

export type AiProviderId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "qwen"
  | "comfyui"
  | "azure-openai";

export type AiCapabilityKind =
  | "chat"
  | "reasoning"
  | "vision"
  | "image"
  | "speech"
  | "embedding"
  | "translation"
  | "ocr";

export interface ProviderModelBundle {
  chat: string;
  reasoning: string;
  image: string;
  imagePinned?: string;
  vision?: string;
  fast?: string;
}

/** 已淘汰、禁止作为业务默认值的模型 ID 片段 */
export const RETIRED_MODEL_PATTERNS = [
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.5-thinking",
  "gpt-image-1",
  "gpt-image-1-mini",
] as const;
