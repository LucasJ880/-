/**
 * OpenAI 模型定义 — 全仓库唯一允许出现默认模型字符串的地方。
 *
 * 业务代码禁止 import 本文件中的字符串字面量以外的用途；
 * 请通过 ModelRegistry / ProviderRouter 读取。
 */

function env(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** 内置默认（仅本文件） */
export const OPENAI_BUILTIN = {
  chat: "gpt-5.6-sol",
  reasoning: "gpt-5.6-terra",
  image: "gpt-image-2",
  imagePinned: "gpt-image-2-2026-04-21",
} as const;

/**
 * OpenAI 模型解析（运行时读 env）。
 * 兼容旧变量：OPENAI_MODEL / OPENAI_MODEL_MINI / OPENAI_MODEL_NANO。
 */
export const OpenAIModels = {
  get chat(): string {
    return env("OPENAI_CHAT_MODEL", "OPENAI_MODEL") ?? OPENAI_BUILTIN.chat;
  },
  get reasoning(): string {
    return (
      env("OPENAI_REASONING_MODEL", "OPENAI_MODEL_MINI") ??
      OPENAI_BUILTIN.reasoning
    );
  },
  get image(): string {
    return env("OPENAI_IMAGE_MODEL") ?? OPENAI_BUILTIN.image;
  },
  get imagePinned(): string {
    return env("OPENAI_IMAGE_MODEL_PINNED") ?? OPENAI_BUILTIN.imagePinned;
  },
  /** Vision 默认走 chat（多模态同族） */
  get vision(): string {
    return env("OPENAI_VISION_MODEL") ?? OpenAIModels.chat;
  },
  /** 轻量任务：未单独配置时回退 chat */
  get fast(): string {
    return env("OPENAI_FAST_MODEL", "OPENAI_MODEL_NANO") ?? OpenAIModels.chat;
  },
} as const;
