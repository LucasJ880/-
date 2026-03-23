/**
 * 青砚 AI 统一配置中心
 *
 * 所有模型、推理力度、任务预设在此集中管理。
 * 其他模块通过 getAIConfig() / getTaskPreset() 读取，不再各自硬编码。
 */

// ── 推理力度 ──────────────────────────────────────────────────

export type ReasoningEffort = "low" | "medium" | "high";

// ── 任务预设 ──────────────────────────────────────────────────

export interface TaskPreset {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
}

const MODEL_PRIMARY = process.env.OPENAI_MODEL || "gpt-5.2";
const MODEL_MINI = process.env.OPENAI_MODEL_MINI || "gpt-5-mini";

export const TASK_PRESETS: Record<string, TaskPreset> = {
  normal: {
    model: MODEL_PRIMARY,
    temperature: 0.5,
    maxTokens: 4096,
    reasoningEffort: "medium",
  },
  deep: {
    model: MODEL_PRIMARY,
    temperature: 0.3,
    maxTokens: 8192,
    reasoningEffort: "high",
  },
  fast: {
    model: MODEL_MINI,
    temperature: 0.6,
    maxTokens: 2048,
    reasoningEffort: "low",
  },
  chat: {
    model: MODEL_PRIMARY,
    temperature: 0.5,
    maxTokens: 4096,
    reasoningEffort: "medium",
  },
} as const;

export type TaskMode = keyof typeof TASK_PRESETS;

export function getTaskPreset(mode: TaskMode = "normal"): TaskPreset {
  return TASK_PRESETS[mode] ?? TASK_PRESETS.normal;
}

// ── 全局 AI 配置 ──────────────────────────────────────────────

export interface AIConfig {
  apiKey: string;
  baseURL: string;
  primaryModel: string;
  miniModel: string;
}

export function getAIConfig(): AIConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    primaryModel: MODEL_PRIMARY,
    miniModel: MODEL_MINI,
  };
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
