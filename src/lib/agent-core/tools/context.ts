/**
 * 跨会话搜索 + Context 压缩工具
 *
 * 让 AI Agent 能够搜索历史对话和获取会话摘要。
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

registry.register({
  name: "context_search_history",
  description: "搜索用户的历史对话记录，按语义相关性匹配。可用于回忆之前讨论过的内容。",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词或问题，如：上次讨论的报价方案",
      },
      source_type: {
        type: "string",
        description: "限定搜索范围：ai_message（全局助手）/ trade_chat（外贸聊天）/ 不传则搜全部",
        enum: ["ai_message", "trade_chat", "project_conversation"],
      },
      limit: {
        type: "string",
        description: "返回结果数量上限，默认 5",
      },
    },
    required: ["query"],
  },
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { searchHistory } = await import("@/lib/context/search-engine");
    type MessageSourceType = import("@/lib/context/types").MessageSourceType;

    try {
      const results = await searchHistory({
        userId: ctx.userId,
        orgId: ctx.orgId,
        query: ctx.args.query as string,
        sourceTypes: ctx.args.source_type
          ? [ctx.args.source_type as MessageSourceType]
          : undefined,
        limit: ctx.args.limit ? parseInt(ctx.args.limit as string, 10) : 5,
      });

      return {
        success: true,
        data: results.map((r) => ({
          sessionTitle: r.sessionTitle,
          role: r.role,
          content: r.content.slice(0, 500),
          similarity: Math.round(r.similarity * 100) / 100,
          date: r.createdAt.toISOString().slice(0, 10),
          sourceType: r.sourceType,
        })),
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

registry.register({
  name: "context_get_summaries",
  description: "获取用户最近对话的摘要列表，了解近期讨论了哪些主题",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "string",
        description: "返回数量，默认 5",
      },
    },
  },
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { getRecentSummaries } = await import("@/lib/context/compressor");

    try {
      const summaries = await getRecentSummaries(
        ctx.userId,
        ctx.args.limit ? parseInt(ctx.args.limit as string, 10) : 5,
      );

      return {
        success: true,
        data: summaries.map((s) => ({
          sessionTitle: s.sessionTitle,
          sourceType: s.sourceType,
          summary: s.summary,
          keyTopics: s.keyTopics,
          keyDecisions: s.keyDecisions,
          messageCount: s.messageCount,
        })),
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

registry.register({
  name: "context_index_messages",
  description: "为用户的历史消息建立搜索索引（首次使用或手动刷新时调用）",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      source_type: {
        type: "string",
        description: "索引范围：ai_message / trade_chat / all",
        enum: ["ai_message", "trade_chat", "all"],
      },
    },
  },
  riskLevel: "medium",
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { indexAiThreadMessages, indexTradeChatMessages } = await import(
      "@/lib/context/search-engine"
    );

    const sourceType = (ctx.args.source_type as string) ?? "all";
    let indexed = 0;

    try {
      if (sourceType === "ai_message" || sourceType === "all") {
        indexed += await indexAiThreadMessages(ctx.userId);
      }
      if (sourceType === "trade_chat" || sourceType === "all") {
        indexed += await indexTradeChatMessages(ctx.userId, ctx.orgId);
      }

      return {
        success: true,
        data: { indexed, message: `已索引 ${indexed} 条消息` },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
