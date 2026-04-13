/**
 * 销售域工具 — 注册到统一工具注册表
 *
 * 将销售 CRM 能力暴露给 Agent Core。
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { db } from "@/lib/db";
import { parseGptQuotePlan, parseLocalQuotePlan } from "@/lib/sales/ai-quote-parser";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";

function ok(data: unknown): ToolExecutionResult {
  return { success: true, data };
}

// ── sales.get_pipeline ──────────────────────────────────────────

registry.register({
  name: "sales.get_pipeline",
  description: "获取销售管道概况：各阶段机会数、总金额、最近活动",
  domain: "sales",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const stages = [
      "new_lead", "needs_confirmed", "measure_booked",
      "quoted", "negotiation", "signed", "producing",
      "installing", "completed", "lost",
    ];

    const pipeline = await Promise.all(
      stages.map(async (stage) => {
        const count = await db.salesOpportunity.count({
          where: {
            stage,
            OR: [
              { assignedToId: ctx.userId },
              { createdById: ctx.userId },
            ],
          },
        });
        return { stage, count };
      }),
    );

    return ok({ pipeline: pipeline.filter((s) => s.count > 0) });
  },
});

// ── sales.search_customers ──────────────────────────────────────

registry.register({
  name: "sales.search_customers",
  description: "搜索销售客户，支持按姓名、电话、邮箱模糊查询",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      limit: { type: "number", description: "返回数量，默认10" },
    },
    required: ["query"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const query = String(ctx.args.query ?? "");
    const limit = Number(ctx.args.limit ?? 10);

    const customers = await db.salesCustomer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { phone: { contains: query } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        _count: { select: { opportunities: true } },
      },
      take: limit,
    });

    return ok({ customers, total: customers.length });
  },
});

// ── sales.get_customer ──────────────────────────────────────────

registry.register({
  name: "sales.get_customer",
  description: "获取单个销售客户的详情，包括机会、最近互动、报价",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
    },
    required: ["customerId"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const customer = await db.salesCustomer.findUnique({
      where: { id: String(ctx.args.customerId) },
      include: {
        opportunities: {
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            stage: true,
            estimatedValue: true,
            priority: true,
            nextFollowupAt: true,
          },
        },
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            type: true,
            summary: true,
            createdAt: true,
          },
        },
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 2,
          select: {
            id: true,
            version: true,
            status: true,
            grandTotal: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) return { success: false, data: { error: "客户不存在" } };
    return ok(customer);
  },
});

// ── sales.list_opportunities ────────────────────────────────────

registry.register({
  name: "sales.list_opportunities",
  description: "列出销售机会，可按阶段或优先级过滤",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", description: "阶段过滤，如 quoted / negotiation" },
      priority: { type: "string", description: "优先级：hot / warm / cold" },
      limit: { type: "number", description: "返回数量，默认10" },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const where: Record<string, unknown> = {
      OR: [
        { assignedToId: ctx.userId },
        { createdById: ctx.userId },
      ],
    };
    if (ctx.args.stage) where.stage = String(ctx.args.stage);
    if (ctx.args.priority) where.priority = String(ctx.args.priority);

    const opps = await db.salesOpportunity.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: Number(ctx.args.limit ?? 10),
    });

    return ok({ opportunities: opps, total: opps.length });
  },
});

// ── sales.get_overview ──────────────────────────────────────────

registry.register({
  name: "sales.get_overview",
  description: "获取销售业务概览：本月成交数、活跃机会数、待跟进数等",
  domain: "sales",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const ownerFilter = {
      OR: [
        { assignedToId: ctx.userId },
        { createdById: ctx.userId },
      ],
    };

    const [active, wonThisMonth, pendingFollowup, totalCustomers] = await Promise.all([
      db.salesOpportunity.count({
        where: {
          ...ownerFilter,
          stage: {
            in: ["new_lead", "needs_confirmed", "measure_booked", "quoted", "negotiation"],
          },
        },
      }),
      db.salesOpportunity.count({
        where: { ...ownerFilter, stage: { in: ["signed", "completed"] }, wonAt: { gte: monthStart } },
      }),
      db.salesOpportunity.count({
        where: { ...ownerFilter, nextFollowupAt: { lte: now } },
      }),
      db.salesCustomer.count({
        where: { createdById: ctx.userId },
      }),
    ]);

    return ok({
      activeOpportunities: active,
      wonThisMonth,
      pendingFollowup,
      totalCustomers,
    });
  },
});

// ── sales.ai_quote ──────────────────────────────────────────

registry.register({
  name: "sales.ai_quote",
  description: "AI 报价助手：解析自然语言描述为结构化报价行项并计算价格。支持格式如 '3 zebra blackout: 39 1/2 x 55, 42 x 60, add 1 hub'",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "用户的自然语言报价描述" },
      currentProduct: { type: "string", description: "当前选中的产品类型" },
    },
    required: ["prompt"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const prompt = String(ctx.args.prompt ?? "");
    const currentProduct = ctx.args.currentProduct as string | undefined;

    const plan = await parseGptQuotePlan(prompt, { currentProduct });

    if (plan.items.length === 0) {
      const localPlan = parseLocalQuotePlan(prompt);
      if (localPlan.items.length > 0) {
        Object.assign(plan, localPlan);
      }
    }

    if (plan.items.length === 0) {
      return { success: false, data: { error: "未能从描述中识别出报价项。请提供产品类型和尺寸。" } };
    }

    const preview = calculateQuoteTotal({
      items: plan.items,
      addons: plan.addons,
      installMode: plan.installMode,
    });

    return ok({
      plan,
      preview: {
        itemCount: preview.itemResults.length,
        merchSubtotal: preview.merchSubtotal,
        installApplied: preview.installApplied,
        addonsSubtotal: preview.addonsSubtotal,
        grandTotal: preview.grandTotal,
        items: preview.itemResults.map((r) => ({
          product: r.input.product,
          fabric: r.input.fabric,
          width: r.input.widthIn,
          height: r.input.heightIn,
          msrp: r.msrp,
          price: r.price,
          install: r.install,
        })),
      },
      parseMethod: plan.parseMethod,
    });
  },
});

// ── sales.create_quote ──────────────────────────────────────

registry.register({
  name: "sales.create_quote",
  description: "为客户创建正式报价单，需提供客户 ID 和产品项",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户 ID" },
      opportunityId: { type: "string", description: "机会 ID（可选）" },
      items: {
        type: "array",
        description: "报价行项数组",
        items: {
          type: "object",
          properties: {
            product: { type: "string" },
            fabric: { type: "string" },
            widthIn: { type: "number" },
            heightIn: { type: "number" },
          },
        },
      },
      installMode: { type: "string", description: "default 或 pickup" },
    },
    required: ["customerId", "items"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { customerId, opportunityId, items, installMode } = ctx.args as {
      customerId: string;
      opportunityId?: string;
      items: Array<{ product: string; fabric: string; widthIn: number; heightIn: number }>;
      installMode?: string;
    };

    const calc = calculateQuoteTotal({
      items: items.map((i) => ({
        product: i.product as any,
        fabric: i.fabric,
        widthIn: i.widthIn,
        heightIn: i.heightIn,
      })),
      installMode: installMode === "pickup" ? "pickup" : "default",
    });

    if (calc.itemResults.length === 0) {
      return { success: false, data: { error: "所有产品项计算失败", details: calc.errors } };
    }

    const existingCount = await db.salesQuote.count({ where: { customerId } });

    const quote = await db.salesQuote.create({
      data: {
        customerId,
        opportunityId: opportunityId || null,
        version: existingCount + 1,
        installMode: installMode || "default",
        aiSource: "text",
        merchSubtotal: calc.merchSubtotal,
        addonsSubtotal: calc.addonsSubtotal,
        installSubtotal: calc.installSubtotal,
        installApplied: calc.installApplied,
        deliveryFee: calc.deliveryFee,
        preTaxTotal: calc.preTaxTotal,
        taxRate: calc.taxRate,
        taxAmount: calc.taxAmount,
        grandTotal: calc.grandTotal,
        createdById: ctx.userId,
        items: {
          create: calc.itemResults.map((r, idx) => ({
            sortOrder: idx,
            product: r.input.product,
            fabric: r.input.fabric,
            widthIn: r.input.widthIn,
            heightIn: r.input.heightIn,
            bracketWidth: r.bracketWidth,
            bracketHeight: r.bracketHeight,
            cordless: r.cordless,
            msrp: r.msrp,
            discountPct: r.discountPct,
            discountValue: r.discountValue,
            price: r.price,
            installFee: r.install,
            location: r.input.location || null,
          })),
        },
      },
    });

    return ok({
      quoteId: quote.id,
      grandTotal: quote.grandTotal,
      itemCount: calc.itemResults.length,
    });
  },
});
