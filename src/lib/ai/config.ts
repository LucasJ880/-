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

const MODEL_PRIMARY = process.env.OPENAI_MODEL || "gpt-5.4";
const MODEL_MINI = process.env.OPENAI_MODEL_MINI || "gpt-5.4-mini";
const MODEL_NANO = process.env.OPENAI_MODEL_NANO || "gpt-5.4-nano";

export const TASK_PRESETS: Record<string, TaskPreset> = {
  normal: {
    model: MODEL_PRIMARY,
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: "medium",
  },
  deep: {
    model: MODEL_PRIMARY,
    temperature: 0.3,
    maxTokens: 16384,
    reasoningEffort: "high",
  },
  fast: {
    model: MODEL_NANO,
    temperature: 0.6,
    maxTokens: 2048,
    reasoningEffort: "low",
  },
  chat: {
    model: MODEL_PRIMARY,
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: "medium",
  },
  structured: {
    model: MODEL_MINI,
    temperature: 0.3,
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
  nanoModel: string;
}

export function getAIConfig(): AIConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    primaryModel: MODEL_PRIMARY,
    miniModel: MODEL_MINI,
    nanoModel: MODEL_NANO,
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

/**
 * 读取 intelligence_report 专属配置，未设置则回退到全局 deep / normal 预设。
 *
 * 环境变量：
 *   OPENAI_MODEL_INTELLIGENCE_REPORT          主模型
 *   OPENAI_TEMPERATURE_INTELLIGENCE_REPORT     温度
 *   OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT      最大输出 token
 *   OPENAI_REASONING_EFFORT_INTELLIGENCE_REPORT  推理力度(low/medium/high)
 *   OPENAI_MODEL_INTELLIGENCE_REPORT_FALLBACK  回退模型
 */
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
    temperature: safeFloat(process.env.OPENAI_TEMPERATURE_INTELLIGENCE_REPORT, deep.temperature),
    maxTokens: safeInt(process.env.OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT, deep.maxTokens),
    reasoningEffort: effort,
    fallbackModel: process.env.OPENAI_MODEL_INTELLIGENCE_REPORT_FALLBACK || normal.model,
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
