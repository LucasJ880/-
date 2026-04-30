/**
 * 外贸域工具 — 注册到统一工具注册表
 *
 * 从现有 chat-assistant.ts 的工具迁移而来，
 * 统一为 ToolDefinition 格式 + OpenAI function calling 兼容。
 */

import { db } from "@/lib/db";
import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { parseResearchBundle, getResearchReportForAgents } from "@/lib/trade/research-bundle";
import { runProspectResearch } from "@/lib/trade/research-service";
import {
  getTradeProspectStageLabel,
  mergeNormalizedProspectStageCounts,
  TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE,
  TRADE_PROSPECT_STAGES,
} from "@/lib/trade/stage";

function ok(data: unknown): ToolExecutionResult {
  return { success: true, data };
}

// ── trade.get_overview ──────────────────────────────────────────

registry.register({
  name: "trade_get_overview",
  description: "获取外贸总览数据：活动数、线索数、报价数、待跟进数、各阶段分布",
  domain: "trade",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const orgId = ctx.orgId;
    const [campaigns, prospects, quotes, followUps] = await Promise.all([
      db.tradeCampaign.count({ where: { orgId } }),
      db.tradeProspect.count({ where: { orgId } }),
      db.tradeQuote.count({ where: { orgId } }),
      db.tradeProspect.count({
        where: {
          orgId,
          nextFollowUpAt: { lt: new Date() },
          stage: { notIn: [...TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE] },
        },
      }),
    ]);

    const stageGroups = await db.tradeProspect.groupBy({
      by: ["stage"],
      where: { orgId },
      _count: true,
    });
    const stages = mergeNormalizedProspectStageCounts(
      stageGroups.map((g) => ({ stage: g.stage, _count: g._count })),
    );

    const quoteSum = await db.tradeQuote.aggregate({
      where: { orgId },
      _sum: { totalAmount: true },
    });

    return ok({
      campaigns,
      prospects,
      quotes,
      quoteTotal: quoteSum._sum.totalAmount ?? 0,
      followUps,
      stages,
    });
  },
});

// ── trade.list_campaigns ────────────────────────────────────────

registry.register({
  name: "trade_list_campaigns",
  description: "列出所有获客活动及其线索统计",
  domain: "trade",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const campaigns = await db.tradeCampaign.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { _count: { select: { prospects: true } } },
    });
    return ok(campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      targetMarket: c.targetMarket,
      prospects: c._count.prospects,
      qualified: c.qualified,
      contacted: c.contacted,
    })));
  },
});

// ── trade.search_prospects ──────────────────────────────────────

registry.register({
  name: "trade_search_prospects",
  description:
    "搜索外贸线索（公司名/国家/联系人）。在调用 trade_run_prospect_research 之前，若用户只给了公司名或可能重名，**优先用本工具列出 id**，再带 prospectId 研究。可选 campaignId 限定某一获客活动。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词（公司名、国家、联系人）" },
      stage: { type: "string", description: "阶段筛选（标准值）", enum: [...TRADE_PROSPECT_STAGES] },
      campaignId: { type: "string", description: "可选，仅返回该活动下的线索" },
    },
  },
  execute: async (ctx: ToolExecutionContext) => {
    const query = ctx.args.query as string | undefined;
    const stage = ctx.args.stage as string | undefined;
    const campaignId = (ctx.args.campaignId as string | undefined)?.trim();

    if (campaignId) {
      const camp = await db.tradeCampaign.findFirst({
        where: { id: campaignId, orgId: ctx.orgId },
        select: { id: true },
      });
      if (!camp) {
        return { success: false, data: { code: "invalid_campaign" }, error: "活动不存在或不属于当前组织" };
      }
    }

    const prospects = await db.tradeProspect.findMany({
      where: {
        orgId: ctx.orgId,
        ...(campaignId ? { campaignId } : {}),
        ...(stage ? { stage } : {}),
        ...(query ? {
          OR: [
            { companyName: { contains: query } },
            { country: { contains: query } },
            { contactName: { contains: query } },
          ],
        } : {}),
      },
      orderBy: { score: "desc" },
      take: 15,
      select: {
        id: true, companyName: true, contactName: true, country: true,
        score: true, stage: true, lastContactAt: true, campaignId: true,
        campaign: { select: { name: true } },
      },
    });

    return ok(prospects);
  },
});

// ── trade.get_prospect ──────────────────────────────────────────

registry.register({
  name: "trade_get_prospect",
  description: "获取某个线索的详细信息（含研究报告、消息历史）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      prospectId: { type: "string", description: "线索 ID" },
      companyName: { type: "string", description: "公司名（模糊匹配）" },
    },
  },
  execute: async (ctx: ToolExecutionContext) => {
    const prospectId = ctx.args.prospectId as string | undefined;
    const companyName = ctx.args.companyName as string | undefined;

    let prospect;
    if (prospectId) {
      prospect = await db.tradeProspect.findUnique({
        where: { id: prospectId },
        include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
    } else if (companyName) {
      prospect = await db.tradeProspect.findFirst({
        where: { orgId: ctx.orgId, companyName: { contains: companyName } },
        include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
    }

    if (!prospect) return { success: false, data: null, error: "未找到该线索" };

    const reportBody = getResearchReportForAgents(prospect.researchReport);
    const parsed = parseResearchBundle(prospect.researchReport);

    return ok({
      id: prospect.id,
      companyName: prospect.companyName,
      contactName: prospect.contactName,
      contactEmail: prospect.contactEmail,
      country: prospect.country,
      score: prospect.score,
      scoreReason: prospect.scoreReason,
      stage: prospect.stage,
      stageLabel: getTradeProspectStageLabel(prospect.stage),
      campaign: prospect.campaign.name,
      lastContactAt: prospect.lastContactAt,
      nextFollowUpAt: prospect.nextFollowUpAt,
      followUpCount: prospect.followUpCount,
      researchSummary: reportBody?.companyOverview?.slice(0, 400) ?? null,
      researchSources: parsed.sources.slice(0, 10),
      recentMessages: prospect.messages.slice(0, 3).map((m) => ({
        direction: m.direction,
        content: m.content.slice(0, 200),
        createdAt: m.createdAt,
      })),
    });
  },
});

// ── trade.get_follow_ups ────────────────────────────────────────

registry.register({
  name: "trade_get_follow_ups",
  description: "获取需要跟进的线索列表（含逾期状态）",
  domain: "trade",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const now = new Date();
    const prospects = await db.tradeProspect.findMany({
      where: {
        orgId: ctx.orgId,
        nextFollowUpAt: { not: null },
        stage: { notIn: [...TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE] },
      },
      orderBy: { nextFollowUpAt: "asc" },
      take: 15,
      select: {
        id: true, companyName: true, contactName: true, stage: true,
        nextFollowUpAt: true, followUpCount: true,
      },
    });

    return ok(prospects.map((p) => ({
      ...p,
      isOverdue: p.nextFollowUpAt! < now,
      daysUntil: Math.ceil((p.nextFollowUpAt!.getTime() - now.getTime()) / 86_400_000),
    })));
  },
});

// ── trade.list_quotes ───────────────────────────────────────────

registry.register({
  name: "trade_list_quotes",
  description: "列出外贸报价单，可按状态筛选",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", description: "状态筛选", enum: ["draft", "sent", "negotiating", "accepted", "rejected", "expired"] },
    },
  },
  execute: async (ctx: ToolExecutionContext) => {
    const status = ctx.args.status as string | undefined;
    const quotes = await db.tradeQuote.findMany({
      where: {
        orgId: ctx.orgId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, quoteNumber: true, companyName: true, status: true,
        currency: true, totalAmount: true, expiresAt: true, createdAt: true,
      },
    });
    return ok(quotes);
  },
});

// ── trade.get_suggestions ───────────────────────────────────────

registry.register({
  name: "trade_get_suggestions",
  description: "获取外贸下一步行动建议（基于当前数据状态）",
  domain: "trade",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const now = new Date();
    const orgId = ctx.orgId;
    const [overdue, noResponse, qualified, draftQuotes] = await Promise.all([
      db.tradeProspect.count({
        where: {
          orgId,
          nextFollowUpAt: { lt: now },
          stage: { notIn: [...TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE] },
        },
      }),
      db.tradeProspect.count({
        where: {
          orgId,
          outreachSentAt: { not: null },
          stage: { in: ["follow_up", "no_response"] },
        },
      }),
      db.tradeProspect.count({
        where: { orgId, stage: "qualified", outreachSentAt: null },
      }),
      db.tradeQuote.count({ where: { orgId, status: "draft" } }),
    ]);

    const suggestions: string[] = [];
    if (overdue > 0) suggestions.push(`${overdue} 条线索跟进已逾期，建议立即处理`);
    if (qualified > 0) suggestions.push(`${qualified} 条合格线索未联系，建议生成开发信`);
    if (noResponse > 0) suggestions.push(`${noResponse} 条线索发信后无回复，建议安排二次跟进`);
    if (draftQuotes > 0) suggestions.push(`${draftQuotes} 份草稿报价未发送，建议检查后发出`);
    if (suggestions.length === 0) suggestions.push("当前暂无紧急事项");

    return ok({ suggestions });
  },
});

// ── trade.run_prospect_research（写 CRM + 真研究）────────────────

registry.register({
  name: "trade_run_prospect_research",
  description:
    "对线索执行完整一轮研究：检索与站内关键页（含 Firecrawl 增强）、生成研究报告（带来源 id）、四维度规则打分并写回 CRM。用户说「研究/背调/评估/跑研究」时使用。建议流程：① trade_search_prospects（可选 campaignId）列候选 id → ② 本工具带 **prospectId**（最稳）。仅 companyName 时：唯一匹配才执行；否则返回 candidates。可用 **campaignId + countryHint** 与公司名组合消歧。可选 website 覆盖本轮抓取官网。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      prospectId: { type: "string", description: "线索 ID（优先）" },
      companyName: {
        type: "string",
        description: "公司名称；多匹配时工具会返回 candidates，需改传 prospectId",
      },
      website: { type: "string", description: "可选，本轮临时使用的官网 URL" },
      campaignId: { type: "string", description: "与 companyName 联用：仅在该活动内解析线索" },
      countryHint: { type: "string", description: "与 companyName 联用：国家/地区关键词（匹配 country 字段）" },
    },
  },
  execute: async (ctx: ToolExecutionContext) => {
    const prospectId = ctx.args.prospectId as string | undefined;
    const companyName = ctx.args.companyName as string | undefined;
    const website = (ctx.args.website as string | undefined)?.trim();
    const campaignId = (ctx.args.campaignId as string | undefined)?.trim();
    const countryHint = (ctx.args.countryHint as string | undefined)?.trim();

    if (campaignId) {
      const camp = await db.tradeCampaign.findFirst({
        where: { id: campaignId, orgId: ctx.orgId },
        select: { id: true },
      });
      if (!camp) {
        return { success: false, data: { code: "invalid_campaign" }, error: "活动不存在或不属于当前组织" };
      }
    }

    if (!prospectId && !companyName?.trim()) {
      return { success: false, data: null, error: "请提供 prospectId 或 companyName" };
    }

    const result = await runProspectResearch(
      prospectId
        ? { prospectId, orgId: ctx.orgId, websiteOverride: website || null }
        : {
            orgId: ctx.orgId,
            companyName: companyName!.trim(),
            websiteHint: website || null,
            campaignId: campaignId || null,
            countryHint: countryHint || null,
          },
      { incrementCampaignQualifiedIfQualified: true },
    );

    if (!result.success) {
      return {
        success: false,
        data: {
          code: result.code,
          ...(result.code === "ambiguous_prospect" && result.candidates?.length
            ? { candidates: result.candidates }
            : {}),
        },
        error: result.error,
      };
    }

    return ok({
      persisted: true,
      prospectId: result.prospectId,
      ...result.chatSummary,
    });
  },
});
