/**
 * GPT-6 Astra 参数兼容。不得把 GPT-5.6 Chat Completions 配置原样复制给 Astra。
 *
 * 官方约束（2026-09）：
 * - Astra 不支持 reasoning.effort / reasoning_effort = "none"（HTTP 400）
 * - 去掉 temperature / top_p / top_logprobs
 * - 有 tool calling 时必须走 Responses API
 * - 推理档位：low | medium | high | xhigh | max；禁止默认 max
 */

import { OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry/openai";
import type { ExtendedReasoningEffort } from "./reasoning";

export function isGpt6Astra(model: string): boolean {
  const id = model.trim().toLowerCase();
  return id === OPENAI_GPT6_ASTRA || id.startsWith(`${OPENAI_GPT6_ASTRA}-`);
}

export function isReasoningFamily(model: string): boolean {
  return isGpt6Astra(model) || /^(gpt-5\.6|o[0-9])/.test(model.trim());
}

export function requiresResponsesApi(model: string, hasTools: boolean): boolean {
  return isGpt6Astra(model) && hasTools;
}

const GPT6_EFFORTS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const GPT56_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "low",
  "medium",
  "high",
]);

/**
 * 把任意 effort 收成当前模型可发送的值。
 * GPT-6 + tools 不得降成 none；GPT-5.6 + tools 仍可 none（Chat Completions 限制）。
 */
export function sanitizeReasoningEffort(input: {
  model: string;
  effort: string;
  hasFunctionTools?: boolean;
}): ExtendedReasoningEffort | "none" {
  const requested = input.effort.trim().toLowerCase();

  if (isGpt6Astra(input.model)) {
    if (requested === "none" || requested === "minimal") return "low";
    if (GPT6_EFFORTS.has(requested)) return requested as ExtendedReasoningEffort;
    return "medium";
  }

  if (isReasoningFamily(input.model)) {
    if (input.hasFunctionTools) return "none";
    if (requested === "xhigh" || requested === "max") return "high";
    if (GPT56_EFFORTS.has(requested)) {
      return requested as ExtendedReasoningEffort | "none";
    }
    return "medium";
  }

  return "medium";
}

export function gpt6UnsupportedChatParams(): string[] {
  return ["temperature", "top_p", "top_logprobs", "logprobs"];
}
