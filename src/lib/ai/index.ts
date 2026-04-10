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

export {
  saveMemory,
  saveMemories,
  getWakeUpMemories,
  recallMemories,
  buildUserMemoryBlock,
  extractMemoriesFromConversation,
} from "./user-memory";
export type { MemoryType, MemoryEntry, ExtractedMemory } from "./user-memory";

export {
  detectLanguage,
  detectConversationLanguage,
  parseWechatConversation,
  parseGenericConversation,
  parseEmailThread,
  extractTopicTags,
  buildChannelStylePrompt,
  CHANNEL_STYLE_GUIDE,
} from "./sales-conversation";
export type {
  Channel,
  Language,
  Sentiment,
  ConversationOutcome,
  RawMessage,
  ParsedConversation,
} from "./sales-conversation";

export {
  extractKnowledgeFromInteraction,
  extractKnowledgeFromCustomer,
  getPlaybooks,
  getFAQs,
  PLAYBOOK_SCENES,
  FAQ_CATEGORIES,
} from "./knowledge-extractor";
export type {
  ExtractedPlaybook,
  ExtractedFAQ,
  ExtractionResult,
} from "./knowledge-extractor";

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
