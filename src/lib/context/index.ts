/**
 * 跨会话搜索 + Context 压缩 — 统一入口
 */

export {
  searchHistory,
  indexAiThreadMessages,
  indexTradeChatMessages,
  getIndexStats,
  rebuildIndex,
} from "./search-engine";

export {
  compressSession,
  compressAllUserSessions,
  getSessionSummary,
  getRecentSummaries,
} from "./compressor";

export type {
  MessageSourceType,
  SessionSourceType,
  SearchResult,
  SearchOptions,
  SessionSummary,
  CompressOptions,
  IndexStats,
} from "./types";
