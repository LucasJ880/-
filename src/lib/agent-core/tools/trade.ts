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
  createServiceRequest,
  type ServiceRequestPriority,
} from "@/lib/trade/service-request";
import {
  getTradeProspectStageLabel,
  mergeNormalizedProspectStageCounts,
  stageAtLeastContacted,
  TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE,
  TRADE_PROSPECT_STAGES,
} from "@/lib/trade/stage";
import { generateOutreachEmail } from "@/lib/trade/agents";
import { updateProspect, createMessage } from "@/lib/trade/service";
import { searchKnowledge } from "@/lib/trade/knowledge-service";

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
      prospect = await db.tradeProspect.findFirst({
        where: { id: prospectId, orgId: ctx.orgId },
        include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
    } else if (companyName) {
      prospect = await db.tradeProspect.findFirst({
        where: { orgId: ctx.orgId, companyName: { contains: companyName } },
        include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
    }

    if (!prospect) return { success: false, data: null, error: "未找到该线索" };
    if (prospect.orgId !== ctx.orgId) {
      return { success: false, data: null, error: "未找到该线索" };
    }

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

// ── trade.create_service_request（受理外贸客户服务需求）──────────

registry.register({
  name: "trade_create_service_request",
  description:
    "受理外贸客户的服务需求并建单（落到当前组织）。适用于美工/产品图处理（design_image）、文档总结（doc_summary）、会议纪要（meeting_minutes）、聊天群记录总结（group_summary）等。当客户明确表达一个具体可执行的需求时使用；闲聊或信息不足时不要建单。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      requestType: {
        type: "string",
        description: "需求类型",
        enum: ["design_image", "doc_summary", "meeting_minutes", "group_summary", "other"],
      },
      title: { type: "string", description: "简短中文标题（<=20字）" },
      description: { type: "string", description: "对需求的客观转述" },
      priority: {
        type: "string",
        description: "优先级，默认 medium",
        enum: ["low", "medium", "high", "urgent"],
      },
      structuredSpec: {
        type: "object",
        description:
          "结构化需求字段对象（仅填客户明确给到或可合理归纳的，未知省略），如 productName/quantity/background/size/style/deadline/notes",
      },
    },
    required: ["requestType", "title"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const orgId = (ctx.orgId ?? "").trim();
    if (!orgId || orgId === "default") {
      return { success: false, data: null, error: "缺少合法 orgId，无法建单（租户隔离）" };
    }

    const title = (ctx.args.title as string | undefined)?.trim();
    if (!title) {
      return { success: false, data: null, error: "请提供需求标题" };
    }
    const requestType = (ctx.args.requestType as string | undefined) ?? "other";
    const description = (ctx.args.description as string | undefined) ?? null;
    const priority = ctx.args.priority as ServiceRequestPriority | undefined;
    const structuredSpec = ctx.args.structuredSpec as Record<string, unknown> | undefined;

    const request = await createServiceRequest({
      orgId,
      requestType,
      title,
      description,
      priority,
      structuredSpec,
      createdById: ctx.userId ?? null,
    });

    return ok({
      created: true,
      requestId: request.id,
      requestType: request.requestType,
      status: request.status,
      title: request.title,
    });
  },
});

// ── trade.search_knowledge（组织知识库，含 vault 导入内容）────────

registry.register({
  name: "trade_search_knowledge",
  description:
    "在当前组织的外贸/产品知识库中检索（含从 Markdown/Obsidian 导入的条目）。用于产品规格、FAQ、认证、案例；只读，不修改知识库。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "检索关键词或问题" },
      category: {
        type: "string",
        description: "可选：product / faq / case_study / certification / process",
      },
    },
    required: ["query"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const orgId = (ctx.orgId ?? "").trim();
    if (!orgId || orgId === "default") {
      return { success: false, data: null, error: "缺少合法 orgId，无法检索知识库" };
    }
    const query = String(ctx.args.query || "").trim();
    if (!query) {
      return { success: false, data: null, error: "query 不能为空" };
    }
    const category =
      typeof ctx.args.category === "string" && ctx.args.category.trim()
        ? ctx.args.category.trim()
        : undefined;
    const context = await searchKnowledge(orgId, query, { category, limit: 5 });
    return ok({
      query,
      category: category ?? null,
      found: Boolean(context),
      context: context || "未找到相关知识条目。可提示用户到「外贸 · 产品知识库」导入 Markdown/ZIP。",
    });
  },
});

// ── 动作工具共用：按 id 或公司名在组织内解析唯一线索 ─────────────

type ProspectResolution =
  | { kind: "ok"; prospect: { id: string; companyName: string; country: string | null } }
  | { kind: "candidates"; candidates: { id: string; companyName: string; country: string | null }[] }
  | { kind: "error"; error: string };

async function resolveProspectForAction(
  orgId: string,
  args: Record<string, unknown>,
): Promise<ProspectResolution> {
  const prospectId = (args.prospectId as string | undefined)?.trim();
  const companyName = (args.companyName as string | undefined)?.trim();

  if (prospectId) {
    const p = await db.tradeProspect.findFirst({
      where: { id: prospectId, orgId },
      select: { id: true, companyName: true, country: true },
    });
    return p
      ? { kind: "ok", prospect: p }
      : { kind: "error", error: "线索不存在或不属于当前组织" };
  }

  if (!companyName) {
    return { kind: "error", error: "请提供 prospectId 或 companyName" };
  }

  const matches = await db.tradeProspect.findMany({
    where: { orgId, companyName: { contains: companyName } },
    select: { id: true, companyName: true, country: true },
    take: 6,
  });
  if (matches.length === 0) return { kind: "error", error: `未找到匹配「${companyName}」的线索` };
  if (matches.length > 1) return { kind: "candidates", candidates: matches };
  return { kind: "ok", prospect: matches[0] };
}

// ── trade.generate_outreach（生成个性化开发信草稿）──────────────

registry.register({
  name: "trade_generate_outreach",
  description:
    "为已研究的线索生成个性化开发信草稿（基于研究报告与活动产品描述，自动匹配客户语言），草稿存入线索的开发信字段，发送仍由人在界面确认。用户说「写开发信/生成开发信/给XX起草邮件」时使用。前置：线索需已有研究报告，否则先用 trade_run_prospect_research。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      prospectId: { type: "string", description: "线索 ID（优先）" },
      companyName: { type: "string", description: "公司名（组织内唯一匹配时可用；多匹配会返回 candidates）" },
      language: { type: "string", description: "可选，强制正文语言（如 English / 中文 / Deutsch）；默认按客户国家自动判断" },
    },
  },
  execute: async (ctx: ToolExecutionContext) => {
    const resolved = await resolveProspectForAction(ctx.orgId, ctx.args);
    if (resolved.kind === "error") return { success: false, data: null, error: resolved.error };
    if (resolved.kind === "candidates") {
      return {
        success: false,
        data: { code: "ambiguous_prospect", candidates: resolved.candidates },
        error: "匹配到多条线索，请让用户选择后改传 prospectId",
      };
    }

    const prospect = await db.tradeProspect.findFirst({
      where: { id: resolved.prospect.id, orgId: ctx.orgId },
      include: { campaign: { select: { productDesc: true } } },
    });
    if (!prospect?.campaign) return { success: false, data: null, error: "线索或所属活动不存在" };

    const report = getResearchReportForAgents(prospect.researchReport);
    if (!report) {
      return {
        success: false,
        data: { code: "research_required", prospectId: prospect.id },
        error: "该线索还没有研究报告，请先调用 trade_run_prospect_research 再生成开发信",
      };
    }

    const [org, user] = await Promise.all([
      db.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } }),
      db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    ]);

    const language = (ctx.args.language as string | undefined)?.trim();
    const draft = await generateOutreachEmail(
      {
        companyName: prospect.companyName,
        contactName: prospect.contactName,
        contactTitle: prospect.contactTitle,
        country: prospect.country,
      },
      report,
      prospect.campaign.productDesc,
      {
        companyName: org?.name ?? "Our Company",
        senderName: user?.name ?? "Sales",
      },
      { ...(language ? { language } : {}), orgId: ctx.orgId },
    );

    await updateProspect(prospect.id, {
      outreachSubject: draft.subject,
      outreachBody: draft.body,
      outreachLang: language ?? "en",
    });

    return ok({
      prospectId: prospect.id,
      companyName: prospect.companyName,
      subject: draft.subject,
      subjectZh: draft.subjectZh,
      bodyPreview: draft.body.slice(0, 400),
      note: "草稿已存入该线索的开发信字段；发送需在线索详情页人工确认（可选 Resend 直发或手动发送后标记）。",
    });
  },
});

// ── trade.log_follow_up（记录跟进并排下一次）────────────────────

registry.register({
  name: "trade_log_follow_up",
  description:
    "为线索记录一次跟进（写入消息时间线），推进阶段至至少「已触达」，并安排下一次跟进时间。用户说「记一下跟进/标记已跟进/跟进完了」时使用。",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      prospectId: { type: "string", description: "线索 ID（优先）" },
      companyName: { type: "string", description: "公司名（组织内唯一匹配时可用）" },
      note: { type: "string", description: "跟进内容摘要（做了什么/客户说了什么）" },
      channel: { type: "string", description: "渠道：email / whatsapp / phone / wechat / other，默认 other" },
      nextFollowUpDays: { type: "number", description: "几天后再跟进，默认 3；传 0 表示今天再看" },
    },
    required: ["note"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const note = (ctx.args.note as string | undefined)?.trim();
    if (!note) return { success: false, data: null, error: "note 不能为空" };

    const resolved = await resolveProspectForAction(ctx.orgId, ctx.args);
    if (resolved.kind === "error") return { success: false, data: null, error: resolved.error };
    if (resolved.kind === "candidates") {
      return {
        success: false,
        data: { code: "ambiguous_prospect", candidates: resolved.candidates },
        error: "匹配到多条线索，请让用户选择后改传 prospectId",
      };
    }

    const channelRaw = (ctx.args.channel as string | undefined)?.trim().toLowerCase();
    const channel = ["email", "whatsapp", "phone", "wechat", "other"].includes(channelRaw ?? "")
      ? channelRaw!
      : "other";
    const daysRaw = Number(ctx.args.nextFollowUpDays);
    const days = Number.isFinite(daysRaw) && daysRaw >= 0 && daysRaw <= 60 ? daysRaw : 3;

    const current = await db.tradeProspect.findFirst({
      where: { id: resolved.prospect.id, orgId: ctx.orgId },
      select: { id: true, stage: true },
    });
    if (!current) return { success: false, data: null, error: "线索不存在或不属于当前组织" };

    await createMessage({
      prospectId: current.id,
      direction: "outbound",
      channel,
      content: note,
    });

    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + days);
    const updated = await db.tradeProspect.update({
      where: { id: current.id },
      data: {
        stage: stageAtLeastContacted(current.stage),
        lastContactAt: now,
        nextFollowUpAt: next,
        followUpCount: { increment: 1 },
      },
      select: { followUpCount: true, stage: true },
    });

    return ok({
      prospectId: current.id,
      companyName: resolved.prospect.companyName,
      stage: updated.stage,
      followUpCount: updated.followUpCount,
      nextFollowUpAt: next.toISOString(),
    });
  },
});
