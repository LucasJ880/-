/**
 * 跨会话搜索 + Context 压缩 — 核心类型
 */

export type MessageSourceType =
  | "ai_message"
  | "trade_chat"
  | "project_conversation"
  | "project_discussion";

export type SessionSourceType =
  | "ai_thread"
  | "trade_chat_session"
  | "conversation";

export interface SearchResult {
  id: string;
  sourceType: MessageSourceType;
  sourceId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: string;
  content: string;
  similarity: number;
  createdAt: Date;
}

export interface SearchOptions {
  userId: string;
  orgId?: string;
  query: string;
  sourceTypes?: MessageSourceType[];
  limit?: number;
  minSimilarity?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SessionSummary {
  sessionId: string;
  sourceType: SessionSourceType;
  sessionTitle: string | null;
  summary: string;
  keyTopics: string[];
  keyDecisions: string[];
  messageCount: number;
  version: number;
}

export interface CompressOptions {
  userId: string;
  sourceType: SessionSourceType;
  sessionId: string;
  force?: boolean;
}

export interface IndexStats {
  totalIndexed: number;
  bySourceType: Record<string, number>;
  lastIndexedAt: Date | null;
}
