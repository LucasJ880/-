/**
 * GPT-6 成本/循环护栏。不替换 Supervisor / Agent Core 已有 limits，
 * 作为新路径默认值与工具结果截断。
 */

export const MODEL_GUARDRAILS = {
  maxAgentTurns: 8,
  maxRetries: 2,
  maxToolCalls: 12,
  maxOutputTokens: 16_384,
  timeoutMs: 120_000,
  maxToolResultChars: 24_000,
} as const;

export function capToolResultPayload(
  value: unknown,
  maxChars: number = MODEL_GUARDRAILS.maxToolResultChars,
): string {
  let raw: string;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    raw = String(value);
  }
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}…[truncated ${raw.length - maxChars} chars]`;
}

export function assertFiniteLoop(input: {
  turns: number;
  toolCalls: number;
  retries: number;
}): { ok: true } | { ok: false; code: "max_turns" | "max_tool_calls" | "max_retries" } {
  if (input.retries > MODEL_GUARDRAILS.maxRetries) {
    return { ok: false, code: "max_retries" };
  }
  if (input.turns > MODEL_GUARDRAILS.maxAgentTurns) {
    return { ok: false, code: "max_turns" };
  }
  if (input.toolCalls > MODEL_GUARDRAILS.maxToolCalls) {
    return { ok: false, code: "max_tool_calls" };
  }
  return { ok: true };
}
