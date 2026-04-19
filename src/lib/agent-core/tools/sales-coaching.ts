/**
 * 销售域工具 — 知识库 / AI 教练 / Deal 健康度
 */

import { Prisma } from "@prisma/client";
import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { ok } from "./sales-helpers";
import {
  salesAssignableScope,
  salesCreatedScope,
} from "@/lib/rbac/data-scope";

// ── sales.search_knowledge ──────────────────────────────────────

registry.register({
  name: "sales_search_knowledge",
  description:
    "在销售知识库中语义搜索。可搜索历史客户沟通、赢单话术、异议应对、最佳实践。" +
    "用于：销售问'类似客户怎么成交的'、'价格异议怎么回应'、'zebra blinds 安装问题'等。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索语义关键词（自然语言）",
      },
      customerId: {
        type: "string",
        description: "限定某客户的知识（可选）",
      },
      mode: {
        type: "string",
        description: "搜索模式：hybrid（混合检索，默认）/ chunks（仅沟通片段）/ insights（仅 AI 洞察）",
      },
      limit: { type: "number", description: "返回数量，默认 5" },
    },
    required: ["query"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { searchKnowledgeChunks, searchInsights, hybridSearch } =
      await import("@/lib/sales/vector-search");

    const query = ctx.args.query as string;
    const mode = (ctx.args.mode as string) ?? "hybrid";
    const limit = (ctx.args.limit as number) ?? 5;
    const customerId = ctx.args.customerId as string | undefined;

    try {
      if (mode === "insights") {
        const results = await searchInsights(query, { limit });
        return ok({
          mode: "insights",
          results: results.map((r) => ({
            title: r.title,
            description: r.description,
            relevance: `${(r.similarity * 100).toFixed(0)}%`,
            effectiveness: r.effectiveness,
            type: r.insightType,
          })),
        });
      }

      if (mode === "chunks") {
        const results = await searchKnowledgeChunks({
          query,
          limit,
          filters: { customerId },
        });
        return ok({
          mode: "chunks",
          results: results.map((r) => ({
            content: r.content.slice(0, 300),
            relevance: `${(r.similarity * 100).toFixed(0)}%`,
            intent: r.intent,
            sentiment: r.sentiment,
            isWinPattern: r.isWinPattern,
            tags: r.tags,
          })),
        });
      }

      const chunks = await hybridSearch(query, { limit, customerId });
      const insights = await searchInsights(query, { limit: 3 });

      return ok({
        mode: "hybrid",
        chunks: chunks.map((r) => ({
          content: r.content.slice(0, 300),
          relevance: `${(r.similarity * 100).toFixed(0)}%`,
          intent: r.intent,
          isWinPattern: r.isWinPattern,
        })),
        insights: insights.map((r) => ({
          title: r.title,
          description: r.description.slice(0, 200),
          relevance: `${(r.similarity * 100).toFixed(0)}%`,
          effectiveness: r.effectiveness,
        })),
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "知识搜索失败" },
      };
    }
  },
});

// ── sales.get_coaching ──────────────────────────────────────────

registry.register({
  name: "sales_get_coaching",
  description:
    "获取针对某客户/商机的 AI 销售建议。基于知识库中的相似案例和赢单模式，" +
    "给出话术推荐、异议应对和下一步行动建议。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户 ID" },
      customerName: { type: "string", description: "客户姓名（可选，用于模糊查找）" },
      situation: {
        type: "string",
        description: "当前情况描述，如'客户说价格太贵'、'已发报价3天没回复'",
      },
    },
    required: ["situation"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { hybridSearch, searchInsights } = await import(
      "@/lib/sales/vector-search"
    );
    const { createCompletion } = await import("@/lib/ai/client");

    const situation = ctx.args.situation as string;
    let customerId = ctx.args.customerId as string | undefined;

    if (!customerId && ctx.args.customerName) {
      const custScope = salesCreatedScope(ctx.userId, ctx.role);
      const customer = await db.salesCustomer.findFirst({
        where: {
          name: { contains: ctx.args.customerName as string, mode: "insensitive" },
          ...(custScope ?? {}),
        },
        select: { id: true },
      });
      customerId = customer?.id;
    }

    try {
      const similarCases = await hybridSearch(situation, { limit: 5, customerId });
      const insights = await searchInsights(situation, { limit: 3, minEffectiveness: 0.3 });

      const contextParts: string[] = [];
      if (similarCases.length > 0) {
        contextParts.push(
          "Similar past conversations:\n" +
            similarCases
              .map(
                (c, i) =>
                  `[${i + 1}] ${c.isWinPattern ? "(WIN PATTERN) " : ""}${c.content.slice(0, 200)}`,
              )
              .join("\n"),
        );
      }
      if (insights.length > 0) {
        contextParts.push(
          "AI Insights:\n" +
            insights
              .map(
                (ins, i) =>
                  `[${i + 1}] ${ins.title}: ${ins.description.slice(0, 150)}`,
              )
              .join("\n"),
        );
      }

      const aiResult = await createCompletion({
        systemPrompt:
          "You are a sales coach for a blinds/curtain company. Based on the knowledge base context, " +
          "give specific, actionable coaching advice. Include: 1) recommended response/script, " +
          "2) why this approach works, 3) next step to take. Be concise and practical. " +
          "Respond in the same language as the situation description.",
        userPrompt: `Current situation: ${situation}\n\nKnowledge base context:\n${contextParts.join("\n\n") || "No relevant history found yet."}`,
        mode: "normal",
        temperature: 0.4,
        maxTokens: 600,
      });

      return ok({
        coaching: aiResult,
        sourcesUsed: {
          similarCases: similarCases.length,
          insights: insights.length,
        },
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "AI 建议生成失败" },
      };
    }
  },
});

// ── sales.get_deal_health ──────────────────────────────────────

registry.register({
  name: "sales_get_deal_health",
  description:
    "获取某客户或商机的 deal 健康度评分（0-100）和最新分析摘要。" +
    "用于回答'XXX 这个客户情况怎么样'、'健康度多少'。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户 ID" },
      customerName: { type: "string", description: "客户姓名（模糊查找）" },
      opportunityId: { type: "string", description: "商机 ID（可选）" },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { aggregateDealHealth } = await import(
      "@/lib/sales/communication-analyzer"
    );

    let customerId = ctx.args.customerId as string | undefined;
    const custScope = salesCreatedScope(ctx.userId, ctx.role);
    if (!customerId && ctx.args.customerName) {
      const c = await db.salesCustomer.findFirst({
        where: {
          name: { contains: ctx.args.customerName as string, mode: "insensitive" },
          ...(custScope ?? {}),
        },
        select: { id: true },
      });
      customerId = c?.id;
    }
    if (!customerId) return { success: false, data: { error: "未找到客户" } };

    // PR1：通过 customerId 直接查询时也要做归属校验（admin 跳过）
    if (custScope) {
      const owned = await db.salesCustomer.findFirst({
        where: { id: customerId, ...custScope },
        select: { id: true },
      });
      if (!owned) return { success: false, data: { error: "未找到客户" } };
    }

    const oppScope = salesAssignableScope(ctx.userId, ctx.role);
    const oppWhere: Record<string, unknown> = ctx.args.opportunityId
      ? { id: ctx.args.opportunityId as string, ...(oppScope ?? {}) }
      : { customerId, ...(oppScope ?? {}) };

    const opps = await db.salesOpportunity.findMany({
      where: oppWhere,
      include: {
        interactions: {
          where: { analysisResult: { not: Prisma.AnyNull } },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { analysisResult: true, createdAt: true },
        },
      },
    });

    const profile = await db.customerProfile.findUnique({
      where: { customerId },
    });

    const allAnalyses: Array<{ dealHealthScore: number; createdAt: Date }> = [];
    const oppSummaries = opps.map((opp) => {
      const analyses = opp.interactions
        .map((i) => {
          const r = i.analysisResult as Record<string, unknown> | null;
          if (!r || typeof r.dealHealthScore !== "number") return null;
          return { dealHealthScore: r.dealHealthScore as number, createdAt: i.createdAt };
        })
        .filter(Boolean) as Array<{ dealHealthScore: number; createdAt: Date }>;
      allAnalyses.push(...analyses);
      const latest = opp.interactions[0]?.analysisResult as Record<string, unknown> | null;
      return {
        id: opp.id,
        title: opp.title,
        stage: opp.stage,
        health: aggregateDealHealth(analyses),
        sentiment: latest?.sentiment ?? null,
        tip: latest?.suggestedNextAction ?? null,
        buyerSignals: latest?.buyerSignals ?? [],
        riskSignals: latest?.riskSignals ?? [],
      };
    });

    return ok({
      overallHealth: aggregateDealHealth(allAnalyses),
      opportunities: oppSummaries,
      profile: profile
        ? {
            customerType: profile.customerType,
            budgetRange: profile.budgetRange,
            winProbability: profile.winProbability,
            priceSensitivity: profile.priceSensitivity,
            keyNeeds: profile.keyNeeds,
            objectionHistory: profile.objectionHistory,
          }
        : null,
    });
  },
});

// ── sales.record_coaching ──────────────────────────────────────

registry.register({
  name: "sales_record_coaching",
  description:
    "记录一条 AI 销售建议。当你给出了具体的跟进建议/话术后，调用此工具记录，" +
    "系统会在 deal 结束时自动评估建议效果，不断自我学习。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户 ID" },
      customerName: { type: "string", description: "客户姓名（模糊查找）" },
      opportunityId: { type: "string", description: "商机 ID（可选）" },
      coachingType: {
        type: "string",
        description: "建议类型：tactic / objection_response / email_draft / next_action",
      },
      recommendation: { type: "string", description: "建议内容" },
    },
    required: ["recommendation"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { createCoachingRecord } = await import(
      "@/lib/sales/coaching-service"
    );

    let customerId = ctx.args.customerId as string | undefined;
    const custScope = salesCreatedScope(ctx.userId, ctx.role);
    if (!customerId && ctx.args.customerName) {
      const c = await db.salesCustomer.findFirst({
        where: {
          name: { contains: ctx.args.customerName as string, mode: "insensitive" },
          ...(custScope ?? {}),
        },
        select: { id: true },
      });
      customerId = c?.id;
    }
    if (!customerId) return { success: false, data: { error: "未找到客户" } };

    // PR1：通过 customerId 直接访问时也做归属校验
    if (custScope) {
      const owned = await db.salesCustomer.findFirst({
        where: { id: customerId, ...custScope },
        select: { id: true },
      });
      if (!owned) return { success: false, data: { error: "未找到客户" } };
    }

    try {
      const record = await createCoachingRecord({
        userId: ctx.userId,
        customerId,
        opportunityId: ctx.args.opportunityId as string | undefined,
        coachingType: (ctx.args.coachingType as "tactic" | "objection_response" | "email_draft" | "next_action") || "next_action",
        recommendation: ctx.args.recommendation as string,
      });

      return ok({
        recordId: record.id,
        message: "建议已记录，deal 结束时将自动评估效果",
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "记录失败" },
      };
    }
  },
});

// ── sales.coaching_feedback ──────────────────────────────────────

registry.register({
  name: "sales_coaching_feedback",
  description:
    "记录销售对 AI 建议的反馈。当销售说'好的用这个'、'试试看'标记为采纳；" +
    "说'不合适'、'换一个'标记为未采纳。用于训练 AI 持续改进建议质量。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      recordId: { type: "string", description: "建议记录 ID" },
      adopted: { type: "boolean", description: "true=采纳, false=忽略" },
    },
    required: ["recordId", "adopted"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { recordAdoption } = await import("@/lib/sales/coaching-service");

    // PR1：确认该 coaching 记录属于当前销售（admin 跳过）
    const recordId = ctx.args.recordId as string;
    const custScope = salesCreatedScope(ctx.userId, ctx.role);
    if (custScope) {
      const rec = await db.coachingRecord.findUnique({
        where: { id: recordId },
        select: { userId: true },
      });
      if (!rec || rec.userId !== ctx.userId) {
        return { success: false, data: { error: "无权操作该建议记录" } };
      }
    }

    try {
      await recordAdoption(
        recordId,
        ctx.args.adopted as boolean,
      );
      return ok({
        message: ctx.args.adopted
          ? "已标记为采纳 ✓ 系统将在成交后学习此建议效果"
          : "已标记为未采纳，感谢反馈",
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "记录失败" },
      };
    }
  },
});
