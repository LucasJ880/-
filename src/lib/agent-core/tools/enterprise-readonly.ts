/**
 * 企业数字员工 Phase 1 — 只读工具补齐
 *
 * 规则：只读、必须 orgId、组织隔离、字段最小化、不返回密钥。
 */

import { db } from "@/lib/db";
import { canSeeResource, salesAssignableScope } from "@/lib/rbac/data-scope";
import { listProjectSimilaritiesForApi } from "@/lib/projects/similarity";
import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { ok } from "./sales-helpers";

async function requireOrgMember(ctx: ToolExecutionContext): Promise<string | null> {
  if (!ctx.orgId) return "缺少组织上下文";
  if (ctx.role === "admin" || ctx.role === "super_admin") return null;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    select: { status: true },
  });
  if (!membership || membership.status !== "active") {
    return "无权访问该组织数据";
  }
  return null;
}

async function loadOrgProject(projectId: string, orgId: string) {
  return db.project.findFirst({
    where: { id: projectId, orgId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      tenderStatus: true,
      aiAdviceStatus: true,
      category: true,
      priority: true,
      clientOrganization: true,
      location: true,
      estimatedValue: true,
      currency: true,
      ourBidPrice: true,
      winningBidPrice: true,
      solicitationNumber: true,
      dueDate: true,
      description: true,
      updatedAt: true,
    },
  });
}

// ── sales aliases / extensions ─────────────────────────────────

registry.register({
  name: "sales_get_pipeline_snapshot",
  description: "销售管道快照（只读别名）：各阶段机会数与近期商机摘要",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "最近商机条数，默认 20" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const ownerScope = salesAssignableScope(ctx.userId, ctx.role, ctx.orgId);
    const stages = [
      "new_lead",
      "needs_confirmed",
      "measure_booked",
      "quoted",
      "negotiation",
      "signed",
      "producing",
      "installing",
      "completed",
      "lost",
    ];
    const pipeline = await Promise.all(
      stages.map(async (stage) => {
        const count = await db.salesOpportunity.count({
          where: { stage, orgId: ctx.orgId, ...(ownerScope ?? {}) },
        });
        return { stage, count };
      }),
    );

    const recent = await db.salesOpportunity.findMany({
      where: { orgId: ctx.orgId, ...(ownerScope ?? {}) },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 20),
      select: {
        id: true,
        title: true,
        stage: true,
        estimatedValue: true,
        priority: true,
        nextFollowupAt: true,
        updatedAt: true,
        customer: { select: { id: true, name: true } },
      },
    });

    return ok({
      pipeline: pipeline.filter((s) => s.count > 0),
      recentOpportunities: recent,
    });
  },
});

registry.register({
  name: "sales_get_opportunity",
  description: "获取单个销售机会详情（只读，组织隔离）",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      opportunityId: { type: "string", description: "商机 ID" },
    },
    required: ["opportunityId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const opp = await db.salesOpportunity.findFirst({
      where: { id: String(ctx.args.opportunityId), orgId: ctx.orgId },
      select: {
        id: true,
        title: true,
        stage: true,
        estimatedValue: true,
        priority: true,
        nextFollowupAt: true,
        measureDate: true,
        installDate: true,
        lostReason: true,
        updatedAt: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
        createdById: true,
        assignedToId: true,
        orgId: true,
      },
    });
    if (!opp) return { success: false, data: { error: "商机不存在" } };
    if (
      !canSeeResource(
        ctx.role,
        ctx.userId,
        {
          orgId: opp.orgId,
          createdById: opp.createdById,
          assignedToId: opp.assignedToId,
        },
        ctx.orgId,
      )
    ) {
      return { success: false, data: { error: "无权访问该商机" } };
    }

    return ok({
      id: opp.id,
      title: opp.title,
      stage: opp.stage,
      estimatedValue: opp.estimatedValue,
      priority: opp.priority,
      nextFollowupAt: opp.nextFollowupAt,
      measureDate: opp.measureDate,
      installDate: opp.installDate,
      lostReason: opp.lostReason,
      updatedAt: opp.updatedAt,
      createdAt: opp.createdAt,
      customer: opp.customer,
      assignedTo: opp.assignedTo,
    });
  },
});

registry.register({
  name: "sales_get_customer_interactions",
  description: "获取客户近期互动记录（只读）",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string" },
      opportunityId: { type: "string" },
      limit: { type: "number", description: "默认 10" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const customerId = ctx.args.customerId
      ? String(ctx.args.customerId)
      : undefined;
    const opportunityId = ctx.args.opportunityId
      ? String(ctx.args.opportunityId)
      : undefined;
    if (!customerId && !opportunityId) {
      return { success: false, data: { error: "请提供 customerId 或 opportunityId" } };
    }

    if (customerId) {
      const customer = await db.salesCustomer.findFirst({
        where: { id: customerId, orgId: ctx.orgId },
        select: { id: true, createdById: true, orgId: true },
      });
      if (!customer) return { success: false, data: { error: "客户不存在" } };
      if (
        !canSeeResource(
          ctx.role,
          ctx.userId,
          { orgId: customer.orgId, createdById: customer.createdById },
          ctx.orgId,
        )
      ) {
        return { success: false, data: { error: "无权访问该客户" } };
      }
    }

    const interactions = await db.customerInteraction.findMany({
      where: {
        orgId: ctx.orgId,
        ...(customerId ? { customerId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Number(ctx.args.limit ?? 10),
      select: {
        id: true,
        type: true,
        channel: true,
        direction: true,
        summary: true,
        sentiment: true,
        outcome: true,
        createdAt: true,
        customerId: true,
        opportunityId: true,
      },
    });

    return ok({ interactions, total: interactions.length });
  },
});

registry.register({
  name: "sales_get_quote_summary",
  description: "获取报价摘要（只读，不含敏感附件 URL）",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      quoteId: { type: "string" },
      customerId: { type: "string" },
      opportunityId: { type: "string" },
      limit: { type: "number", description: "列表模式默认 5" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    if (ctx.args.quoteId) {
      const quote = await db.salesQuote.findFirst({
        where: { id: String(ctx.args.quoteId), orgId: ctx.orgId },
        select: {
          id: true,
          version: true,
          status: true,
          currency: true,
          merchSubtotal: true,
          addonsSubtotal: true,
          installApplied: true,
          taxAmount: true,
          grandTotal: true,
          sentAt: true,
          viewedAt: true,
          signedAt: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          opportunityId: true,
          _count: { select: { items: true, addons: true } },
        },
      });
      if (!quote) return { success: false, data: { error: "报价不存在" } };
      return ok({ quote });
    }

    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (ctx.args.customerId) where.customerId = String(ctx.args.customerId);
    if (ctx.args.opportunityId) {
      where.opportunityId = String(ctx.args.opportunityId);
    }

    const quotes = await db.salesQuote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(ctx.args.limit ?? 5),
      select: {
        id: true,
        version: true,
        status: true,
        currency: true,
        grandTotal: true,
        sentAt: true,
        viewedAt: true,
        signedAt: true,
        createdAt: true,
        customerId: true,
        opportunityId: true,
      },
    });
    return ok({ quotes, total: quotes.length });
  },
});

// ── project readonly ───────────────────────────────────────────

registry.register({
  name: "project_get_tender_summary",
  description: "招投标项目摘要（只读）：状态、金额、AI 建议态、情报摘要",
  domain: "project",
  parameters: {
    type: "object",
    properties: { projectId: { type: "string" } },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const intelligence = await db.projectIntelligence.findUnique({
      where: { projectId: project.id },
      select: {
        recommendation: true,
        riskLevel: true,
        fitScore: true,
        summary: true,
        reportStatus: true,
      },
    });

    return ok({ project, intelligence });
  },
});

registry.register({
  name: "project_get_project_documents",
  description: "列出项目文档元数据与解析摘要（只读，截断正文）",
  domain: "project",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      limit: { type: "number", description: "默认 20" },
    },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const docs = await db.projectDocument.findMany({
      where: { projectId: project.id },
      orderBy: { sortOrder: "asc" },
      take: Number(ctx.args.limit ?? 20),
      select: {
        id: true,
        title: true,
        fileType: true,
        parseStatus: true,
        aiSummaryStatus: true,
        aiSummaryJson: true,
        contentText: true,
        createdAt: true,
      },
    });

    return ok({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        fileType: d.fileType,
        parseStatus: d.parseStatus,
        aiSummaryStatus: d.aiSummaryStatus,
        aiSummaryJson: d.aiSummaryJson,
        contentPreview: d.contentText ? d.contentText.slice(0, 1200) : null,
        createdAt: d.createdAt,
      })),
    });
  },
});

registry.register({
  name: "project_get_project_requirements",
  description:
    "从项目文档摘要/情报中提取需求要点（只读近似；完整强制矩阵由技能生成）",
  domain: "project",
  parameters: {
    type: "object",
    properties: { projectId: { type: "string" } },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const [intelligence, docs] = await Promise.all([
      db.projectIntelligence.findUnique({
        where: { projectId: project.id },
        select: {
          summary: true,
          structuredSummaryJson: true,
          recommendation: true,
          riskLevel: true,
        },
      }),
      db.projectDocument.findMany({
        where: {
          projectId: project.id,
          aiSummaryStatus: "done",
        },
        take: 15,
        select: {
          id: true,
          title: true,
          aiSummaryJson: true,
        },
      }),
    ]);

    return ok({
      projectId: project.id,
      intelligence,
      documentSummaries: docs,
      note: "结构化强制条款以技能输出为准；本工具仅返回已解析摘要原料",
    });
  },
});

registry.register({
  name: "project_get_project_inquiries",
  description: "列出项目询价轮次（只读）",
  domain: "project",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      limit: { type: "number" },
    },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const inquiries = await db.projectInquiry.findMany({
      where: { projectId: project.id },
      orderBy: { roundNumber: "desc" },
      take: Number(ctx.args.limit ?? 10),
      select: {
        id: true,
        roundNumber: true,
        title: true,
        scope: true,
        status: true,
        dueDate: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    });
    return ok({ inquiries });
  },
});

registry.register({
  name: "project_get_project_quotes",
  description: "列出项目报价（只读摘要）",
  domain: "project",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      limit: { type: "number" },
    },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const quotes = await db.projectQuote.findMany({
      where: { projectId: project.id },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 10),
      select: {
        id: true,
        version: true,
        status: true,
        title: true,
        currency: true,
        tradeTerms: true,
        deliveryDays: true,
        validUntil: true,
        subtotal: true,
        totalAmount: true,
        profitMargin: true,
        aiGenerated: true,
        updatedAt: true,
      },
    });
    return ok({ quotes });
  },
});

registry.register({
  name: "project_search_similar_projects",
  description: "检索组织内相似历史项目（只读）",
  domain: "project",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      limit: { type: "number", description: "默认 8" },
    },
    required: ["projectId"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    // 只读：优先返回已缓存相似项目；无缓存时按同组织类别做轻量候选，不写库
    const cached = await listProjectSimilaritiesForApi(project.id);
    if (cached.length > 0) {
      return ok({
        similar: cached.slice(0, Number(ctx.args.limit ?? 8)),
        source: "cache",
      });
    }

    const candidates = await db.project.findMany({
      where: {
        orgId: ctx.orgId,
        id: { not: project.id },
        ...(project.category ? { category: project.category } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 8),
      select: {
        id: true,
        name: true,
        tenderStatus: true,
        category: true,
        clientOrganization: true,
        location: true,
        estimatedValue: true,
        currency: true,
        ourBidPrice: true,
        winningBidPrice: true,
        aiAdviceStatus: true,
      },
    });
    return ok({ similar: candidates, source: "org_category_fallback" });
  },
});

// ── knowledge alias ────────────────────────────────────────────

registry.register({
  name: "knowledge_search_org",
  description: "组织知识库检索（只读别名，等同 org_search_knowledge）",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  execute: async (ctx) => {
    const tool = registry.get("org_search_knowledge");
    if (!tool) {
      return { success: false, data: null, error: "org_search_knowledge 未注册" };
    }
    return tool.execute(ctx);
  },
});

registry.register({
  name: "knowledge_search_project",
  description: "在项目文档与情报中关键词检索（只读）",
  domain: "project",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["projectId", "query"],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: { error: denied } };

    const project = await loadOrgProject(String(ctx.args.projectId), ctx.orgId);
    if (!project) return { success: false, data: { error: "项目不存在或不属于当前组织" } };

    const q = String(ctx.args.query).trim();
    if (!q) return { success: false, data: { error: "query 不能为空" } };

    const docs = await db.projectDocument.findMany({
      where: {
        projectId: project.id,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { contentText: { contains: q, mode: "insensitive" } },
          { aiSummaryJson: { contains: q, mode: "insensitive" } },
        ],
      },
      take: Number(ctx.args.limit ?? 8),
      select: {
        id: true,
        title: true,
        fileType: true,
        contentText: true,
        aiSummaryJson: true,
      },
    });

    return ok({
      hits: docs.map((d) => ({
        documentId: d.id,
        title: d.title,
        fileType: d.fileType,
        snippet: (d.contentText || d.aiSummaryJson || "").slice(0, 500),
      })),
    });
  },
});

// ── marketing readonly ─────────────────────────────────────────

registry.register({
  name: "marketing_get_channel_metrics",
  description: "读取组织渠道周/日指标快照（只读）",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "默认 40" },
      granularity: { type: "string", description: "weekly / daily / snapshot" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: null, error: denied };

    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (ctx.args.granularity) where.granularity = String(ctx.args.granularity);

    const rows = await db.marketingMetricSnapshot.findMany({
      where,
      orderBy: { capturedAt: "desc" },
      take: Number(ctx.args.limit ?? 40),
      select: {
        id: true,
        source: true,
        capturedAt: true,
        periodStart: true,
        periodEnd: true,
        granularity: true,
        geography: true,
        impressions: true,
        clicks: true,
        leads: true,
        qualifiedLeads: true,
        appointments: true,
        quotes: true,
        wins: true,
        spend: true,
        revenue: true,
        currency: true,
        dataQualityStatus: true,
        channelAccountId: true,
        campaignId: true,
      },
    });

    const datasets = await db.mmmDatasetVersion.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        name: true,
        weekCount: true,
        rowCount: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        granularity: true,
        qualityIssues: true,
      },
    });

    return { success: true, data: { metrics: rows, recentDatasets: datasets } };
  },
});

registry.register({
  name: "marketing_get_experiments",
  description: "列出营销实验（只读）",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      limit: { type: "number" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: null, error: denied };

    const experiments = await db.marketingExperiment.findMany({
      where: {
        orgId: ctx.orgId,
        ...(ctx.args.status ? { status: String(ctx.args.status) } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 20),
      select: {
        id: true,
        name: true,
        hypothesis: true,
        primaryMetric: true,
        status: true,
        stopCondition: true,
        startsAt: true,
        endsAt: true,
        campaignId: true,
        learningSummary: true,
        updatedAt: true,
      },
    });
    return { success: true, data: { experiments } };
  },
});

registry.register({
  name: "marketing_get_brand_profile",
  description: "读取品牌语料与营销事实档案（只读）",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: null, error: denied };

    const [brand, marketingBrand] = await Promise.all([
      db.brandProfile.findUnique({
        where: { orgId: ctx.orgId },
        select: {
          brandName: true,
          tagline: true,
          positioning: true,
          sellingPoints: true,
          targetAudience: true,
          toneOfVoice: true,
          serviceScope: true,
          caseStudies: true,
          forbiddenClaims: true,
          updatedAt: true,
        },
      }),
      db.marketingBrandProfile.findUnique({
        where: { orgId: ctx.orgId },
        select: {
          id: true,
          legalName: true,
          brandName: true,
          website: true,
          city: true,
          region: true,
          country: true,
          industry: true,
          productsJson: true,
          serviceAreasJson: true,
          competitorsJson: true,
          validationStatus: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      success: true,
      data: {
        brandProfile: brand,
        marketingBrandProfile: marketingBrand,
      },
    };
  },
});

registry.register({
  name: "marketing_get_product_context",
  description: "读取当前组织已确认/聚合的 Product Marketing Context（只读，按 org 隔离）",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: null, error: denied };
    const {
      getProductMarketingContext,
      getProductContextCompleteness,
    } = await import("@/lib/marketing/product-marketing-context");
    const context = await getProductMarketingContext(ctx.orgId);
    const completeness = getProductContextCompleteness(context);
    return {
      success: true,
      data: {
        context,
        completeness,
        // 不返回密钥；仅结构化营销上下文
      },
    };
  },
});

registry.register({
  name: "marketing_get_campaigns",
  description: "列出当前组织营销活动（只读）",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      limit: { type: "number" },
    },
    required: [],
  },
  execute: async (ctx) => {
    const denied = await requireOrgMember(ctx);
    if (denied) return { success: false, data: null, error: denied };
    const campaigns = await db.marketingCampaign.findMany({
      where: {
        orgId: ctx.orgId,
        ...(ctx.args.status ? { status: String(ctx.args.status) } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 20),
      select: {
        id: true,
        name: true,
        objective: true,
        product: true,
        geography: true,
        status: true,
        budget: true,
        currency: true,
        startsAt: true,
        endsAt: true,
        updatedAt: true,
      },
    });
    return { success: true, data: { campaigns } };
  },
});
