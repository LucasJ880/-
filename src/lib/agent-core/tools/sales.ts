/**
 * 销售域工具 — 注册到统一工具注册表
 *
 * 将销售 CRM 能力暴露给 Agent Core。
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { db } from "@/lib/db";

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
      "new_inquiry", "consultation_booked", "measured",
      "quoted", "negotiation", "won", "lost",
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
            in: ["new_inquiry", "consultation_booked", "measured", "quoted", "negotiation"],
          },
        },
      }),
      db.salesOpportunity.count({
        where: { ...ownerFilter, stage: "won", wonAt: { gte: monthStart } },
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
