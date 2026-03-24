/**
 * 青砚 AI 模块 — 统一入口
 */

export { getAIConfig, isAIConfigured, getTaskPreset, TASK_PRESETS } from "./config";
export type { AIConfig, TaskPreset, TaskMode, ReasoningEffort } from "./config";

export { getClient, createChatStream, createCompletion } from "./client";
export type { ChatStreamOptions, CompletionOptions } from "./client";

export {
  getChatSystemPrompt,
  getSummarySystemPrompt,
  getTaskBreakdownPrompt,
  getActionAdvicePrompt,
  buildContextBlock,
  buildProjectDeepBlock,
} from "./prompts";
export type {
  WorkContext,
  ProjectSummary,
  ProjectDeepContext,
} from "./prompts";

export {
  getWorkContext,
  getProjectDeepContext,
  matchProjectByName,
} from "./context";

export {
  prepareConversation,
  buildSummaryPrefix,
} from "./conversation";
export type { ChatMessage, PreparedConversation } from "./conversation";

export { extractWorkSuggestion, extractTaskSuggestion } from "./parser";

export type {
  TaskSuggestion,
  EventSuggestion,
  StageAdvanceSuggestion,
  WorkSuggestion,
  SubTask,
  TaskBreakdown,
  Summary,
  ActionItem,
  ActionAdvice,
} from "./schemas";
