/**
 * 青砚 AI 统一配置中心
 *
 * 模型名称唯一来源：ModelRegistry / ProviderRouter。
 */

import { ProviderRouter } from "@/lib/ai/model-registry";

// ── 推理力度 ──────────────────────────────────────────────────

export type ReasoningEffort = "low" | "medium" | "high";

// ── 任务预设 ──────────────────────────────────────────────────

export interface TaskPreset {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
}

export const TASK_PRESETS: Record<string, TaskPreset> = {
  normal: {
    get model() {
      return ProviderRouter.getChatModel();
    },
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: "medium",
  },
  deep: {
    get model() {
      return ProviderRouter.getReasoningModel();
    },
    temperature: 0.3,
    maxTokens: 16384,
    reasoningEffort: "high",
  },
  fast: {
    get model() {
      return ProviderRouter.getFastModel();
    },
    temperature: 0.6,
    maxTokens: 2048,
    reasoningEffort: "low",
  },
  chat: {
    get model() {
      return ProviderRouter.getChatModel();
    },
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: "medium",
  },
  structured: {
    get model() {
      return ProviderRouter.getReasoningModel();
    },
    temperature: 0.3,
    maxTokens: 4096,
    reasoningEffort: "medium",
  },
};

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
  nanoModel: string;
  imageModel: string;
  imagePinnedModel: string;
  chatModel: string;
  reasoningModel: string;
}

export function getAIConfig(): AIConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    primaryModel: ProviderRouter.getChatModel(),
    chatModel: ProviderRouter.getChatModel(),
    miniModel: ProviderRouter.getReasoningModel(),
    reasoningModel: ProviderRouter.getReasoningModel(),
    nanoModel: ProviderRouter.getFastModel(),
    imageModel: ProviderRouter.getImageModel(),
    imagePinnedModel: ProviderRouter.getImagePinnedModel(),
  };
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ── Intelligence Report 专属配置 ─────────────────────────────

export interface IntelligenceReportConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
  fallbackModel: string;
  fallbackTemperature: number;
  fallbackMaxTokens: number;
  fallbackReasoningEffort: ReasoningEffort;
  primaryTimeoutMs: number;
  fallbackTimeoutMs: number;
  promptVersion: string;
}

export function getIntelligenceReportConfig(): IntelligenceReportConfig {
  const deep = TASK_PRESETS.deep;
  const normal = TASK_PRESETS.normal;

  const rawEffort = process.env.OPENAI_REASONING_EFFORT_INTELLIGENCE_REPORT;
  const effort: ReasoningEffort =
    rawEffort === "low" || rawEffort === "medium" || rawEffort === "high"
      ? rawEffort
      : deep.reasoningEffort;

  return {
    model: process.env.OPENAI_MODEL_INTELLIGENCE_REPORT || deep.model,
    temperature: safeFloat(
      process.env.OPENAI_TEMPERATURE_INTELLIGENCE_REPORT,
      deep.temperature,
    ),
    maxTokens: safeInt(
      process.env.OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT,
      deep.maxTokens,
    ),
    reasoningEffort: effort,
    fallbackModel:
      process.env.OPENAI_MODEL_INTELLIGENCE_REPORT_FALLBACK || normal.model,
    fallbackTemperature: normal.temperature,
    fallbackMaxTokens: normal.maxTokens,
    fallbackReasoningEffort: "medium",
    primaryTimeoutMs: 50_000,
    fallbackTimeoutMs: 50_000,
    promptVersion: "intelligence_report_v2",
  };
}

function safeFloat(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

function safeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : fallback;
}

export { ModelRegistry, ProviderRouter } from "@/lib/ai/model-registry";
