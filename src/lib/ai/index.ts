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
  buildContextBlock,
  buildProjectDeepBlock,
  getQuoteTemplatePrompt,
  getQuoteDraftPrompt,
  getQuoteReviewPrompt,
} from "./prompts";
export type {
  WorkContext,
  ProjectSummary,
  ProjectDeepContext,
  QuoteTemplateRecommendContext,
  QuoteDraftContext,
  QuoteReviewContext,
} from "./prompts";

export {
  getWorkContext,
  getProjectDeepContext,
  matchProjectByName,
} from "./context";

export { getProjectAiMemory, buildMemoryBlock } from "./memory";
export type { ProjectAiMemory } from "./memory";

export {
  prepareConversation,
  buildSummaryPrefix,
} from "./conversation";
export type { ChatMessage, PreparedConversation } from "./conversation";

export { getSalesContext, buildSalesContextBlock } from "./sales-context";
export type { SalesContext } from "./sales-context";

export { extractWorkSuggestion, extractTaskSuggestion } from "./parser";

export type {
  TaskSuggestion,
  EventSuggestion,
  StageAdvanceSuggestion,
  SupplierRecommendSuggestion,
  SupplierRecommendItem,
  QuestionEmailSuggestion,
  AgentTaskSuggestion,
  WorkSuggestion,
  SubTask,
  TaskBreakdown,
  Summary,
  ActionItem,
  ActionAdvice,
} from "./schemas";
