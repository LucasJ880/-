/**
 * 销售域工具 — 商机 / 管道管理
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { ok } from "./sales-helpers";

// ── sales.get_pipeline ──────────────────────────────────────────

registry.register({
  name: "sales_get_pipeline",
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

// ── sales.list_opportunities ────────────────────────────────────

registry.register({
  name: "sales_list_opportunities",
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
  name: "sales_get_overview",
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

// ── sales.advance_stage ───────────────────────────────────────

registry.register({
  name: "sales_advance_stage",
  description:
    "手动推进商机阶段。适用于销售通过语音指令推进，如'把 Lucas 推进到洽谈中'",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      opportunityId: { type: "string", description: "商机ID" },
      customerName: { type: "string", description: "客户姓名（用于搜索商机）" },
      targetStage: {
        type: "string",
        description:
          "目标阶段：new_lead / needs_confirmed / measure_booked / quoted / negotiation / signed / producing / installing / completed / lost",
      },
    },
    required: ["targetStage"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    let opportunityId = ctx.args.opportunityId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;
    const targetStage = String(ctx.args.targetStage);

    if (!opportunityId && customerName) {
      const customer = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!customer)
        return { success: false, data: { error: `未找到客户 "${customerName}"` } };

      const opp = await db.salesOpportunity.findFirst({
        where: {
          customerId: customer.id,
          stage: { notIn: ["lost", "completed", "on_hold"] },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, stage: true },
      });
      if (!opp)
        return { success: false, data: { error: `客户 "${customerName}" 没有活跃商机` } };
      opportunityId = opp.id;
    }

    if (!opportunityId)
      return { success: false, data: { error: "请提供商机ID或客户姓名" } };

    const opp = await db.salesOpportunity.findUnique({
      where: { id: opportunityId },
      include: { customer: { select: { name: true } } },
    });
    if (!opp) return { success: false, data: { error: "商机不存在" } };

    const previousStage = opp.stage;
    await db.salesOpportunity.update({
      where: { id: opportunityId },
      data: { stage: targetStage },
    });

    return ok({
      opportunityId,
      customerName: opp.customer?.name,
      previousStage,
      newStage: targetStage,
    });
  },
});
