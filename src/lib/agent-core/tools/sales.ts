/**
 * 销售域工具 — 注册到统一工具注册表
 *
 * 将销售 CRM 能力暴露给 Agent Core。
 */

import { Prisma } from "@prisma/client";
import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { db } from "@/lib/db";
import { parseGptQuotePlan, parseLocalQuotePlan } from "@/lib/sales/ai-quote-parser";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { onQuoteCreated } from "@/lib/sales/opportunity-lifecycle";

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

    // 生命周期自动化：关联商机 + 推进阶段
    const lifecycle = await onQuoteCreated(
      quote.id, customerId, calc.grandTotal, opportunityId,
    ).catch(() => ({ opportunityId: null, advanced: false }));

    return ok({
      quoteId: quote.id,
      grandTotal: quote.grandTotal,
      itemCount: calc.itemResults.length,
      opportunityLinked: !!lifecycle.opportunityId,
      stageAdvanced: lifecycle.advanced,
    });
  },
});

// ── sales.get_customer_quotes ─────────────────────────────────

registry.register({
  name: "sales.get_customer_quotes",
  description:
    "获取指定客户的报价列表，支持按产品类型过滤（如 zebra / roller）。返回报价金额、状态、分享链接等。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
      customerName: {
        type: "string",
        description: "客户姓名（如果不知道ID可以用名字搜索）",
      },
      productFilter: {
        type: "string",
        description: "可选：按产品类型过滤，如 Zebra、Roller、Drapery",
      },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    let customerId = ctx.args.customerId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;
    const productFilter = ctx.args.productFilter as string | undefined;

    // 如果没有 ID 但有名字，先搜索
    if (!customerId && customerName) {
      const found = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (!found) return { success: false, data: { error: `未找到名为 "${customerName}" 的客户` } };
      customerId = found.id;
    }

    if (!customerId) {
      return { success: false, data: { error: "请提供客户ID或客户姓名" } };
    }

    const quotes = await db.salesQuote.findMany({
      where: { customerId },
      include: {
        items: { select: { product: true, fabric: true, price: true, location: true } },
        customer: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    let filtered = quotes;
    if (productFilter) {
      const pf = productFilter.toLowerCase();
      filtered = quotes.filter((q) =>
        q.items.some((i) => i.product.toLowerCase().includes(pf)),
      );
    }

    return ok({
      customerName: quotes[0]?.customer?.name,
      customerEmail: quotes[0]?.customer?.email,
      totalQuotes: quotes.length,
      filteredCount: filtered.length,
      quotes: filtered.map((q) => ({
        id: q.id,
        version: q.version,
        status: q.status,
        grandTotal: q.grandTotal,
        shareToken: q.shareToken,
        createdAt: q.createdAt,
        products: [...new Set(q.items.map((i) => i.product))].join(", "),
        itemCount: q.items.length,
        items: q.items.map((i) => ({
          product: i.product,
          fabric: i.fabric,
          price: i.price,
          location: i.location,
        })),
      })),
    });
  },
});

// ── sales.compose_email ───────────────────────────────────────

registry.register({
  name: "sales.compose_email",
  description:
    "AI 生成邮件预览（不发送）。生成后展示给用户确认，用户说'发送'时再调用 sales.send_quote_email。用户说'改一下'时调用 sales.refine_email 修改。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
      customerName: { type: "string", description: "客户姓名" },
      scene: { type: "string", description: "场景：quote_initial / quote_followup / quote_viewed / quote_resend / general_followup" },
      quoteId: { type: "string", description: "报价ID（可选）" },
      productFilter: { type: "string", description: "产品过滤" },
      extraInstructions: { type: "string", description: "AI 额外指令" },
    },
    required: ["scene"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail } = await import("@/lib/sales/email-composer");

    let customerId = ctx.args.customerId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;

    if (!customerId && customerName) {
      const found = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!found) return { success: false, data: { error: `未找到客户 "${customerName}"` } };
      customerId = found.id;
    }

    if (!customerId) return { success: false, data: { error: "请提供客户ID或姓名" } };

    try {
      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: (ctx.args.scene as string) as import("@/lib/sales/email-composer").EmailScene,
        quoteId: ctx.args.quoteId as string | undefined,
        productFilter: ctx.args.productFilter as string | undefined,
        extraInstructions: ctx.args.extraInstructions as string | undefined,
      });

      const textPreview = email.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return ok({
        preview: true,
        to: email.to,
        subject: email.subject,
        body: textPreview.slice(0, 500),
        quoteId: email.quoteId,
        customerId,
        scene: email.scene,
        instruction: "邮件已生成，请展示给用户并等待确认。用户说'发送/发/确认/好的'→调用 sales.send_quote_email；用户要修改→调用 sales.refine_email",
      });
    } catch (err) {
      return { success: false, data: { error: err instanceof Error ? err.message : "生成失败" } };
    }
  },
});

// ── sales.refine_email ────────────────────────────────────────

registry.register({
  name: "sales.refine_email",
  description:
    "AI 修改邮件内容。用户对预览邮件不满意时调用，传入修改指令让AI优化。修改后再次展示给用户确认。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID（用于重新生成）" },
      customerName: { type: "string", description: "客户姓名" },
      scene: { type: "string", description: "场景" },
      refinement: { type: "string", description: "用户的修改指令，如：语气更热情/加上折扣信息/更简短" },
    },
    required: ["refinement"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail } = await import("@/lib/sales/email-composer");

    let customerId = ctx.args.customerId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;

    if (!customerId && customerName) {
      const found = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true },
      });
      if (found) customerId = found.id;
    }

    if (!customerId) return { success: false, data: { error: "请提供客户ID或姓名" } };

    try {
      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: ((ctx.args.scene as string) || "general_followup") as import("@/lib/sales/email-composer").EmailScene,
        extraInstructions: ctx.args.refinement as string,
      });

      const textPreview = email.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return ok({
        preview: true,
        refined: true,
        to: email.to,
        subject: email.subject,
        body: textPreview.slice(0, 500),
        quoteId: email.quoteId,
        customerId,
        scene: email.scene,
        instruction: "修改后的邮件已生成。展示给用户，等待确认发送或继续修改。",
      });
    } catch (err) {
      return { success: false, data: { error: err instanceof Error ? err.message : "修改失败" } };
    }
  },
});

// ── sales.send_quote_email ────────────────────────────────────

registry.register({
  name: "sales.send_quote_email",
  description:
    "向客户发送报价邮件。AI 自动生成邮件内容，支持多种场景（首发/跟进/重发）。支持 Gmail OAuth 和 SMTP 双通道。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
      customerName: { type: "string", description: "客户姓名（用于搜索）" },
      quoteId: { type: "string", description: "指定报价ID（可选）" },
      productFilter: { type: "string", description: "按产品类型过滤（如 Zebra）" },
      scene: {
        type: "string",
        description: "邮件场景：quote_initial / quote_followup / quote_viewed / quote_resend / general_followup",
      },
      extraInstructions: { type: "string", description: "给AI的额外指示，如特殊折扣信息" },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail, sendSalesEmail } = await import("@/lib/sales/email-composer");

    let customerId = ctx.args.customerId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;

    if (!customerId && customerName) {
      const found = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!found)
        return { success: false, data: { error: `未找到名为 "${customerName}" 的客户` } };
      customerId = found.id;
    }

    if (!customerId)
      return { success: false, data: { error: "请提供客户ID或客户姓名" } };

    const scene = (ctx.args.scene as string) || "quote_initial";

    try {
      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: scene as import("@/lib/sales/email-composer").EmailScene,
        quoteId: ctx.args.quoteId as string | undefined,
        productFilter: ctx.args.productFilter as string | undefined,
        extraInstructions: ctx.args.extraInstructions as string | undefined,
      });

      const result = await sendSalesEmail(ctx.userId, email);

      if (!result.success) {
        return { success: false, data: { error: result.error } };
      }

      // 更新报价状态
      if (email.quoteId) {
        await db.salesQuote.update({
          where: { id: email.quoteId },
          data: { status: "sent", sentAt: new Date() },
        }).catch(() => {});
      }

      // 记录互动
      await db.customerInteraction.create({
        data: {
          customerId,
          type: "email",
          direction: "outbound",
          summary: `AI ${scene} 邮件已发送 — ${email.subject}`,
          createdById: ctx.userId,
        },
      }).catch(() => {});

      return ok({
        sent: true,
        to: email.to,
        subject: email.subject,
        method: result.method,
        quoteId: email.quoteId,
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "邮件发送失败" },
      };
    }
  },
});

// ── sales.advance_stage ───────────────────────────────────────

registry.register({
  name: "sales.advance_stage",
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

// ── sales.create_appointment ──────────────────────────────────

registry.register({
  name: "sales.create_appointment",
  description:
    "为客户创建预约（量房、安装、回访、咨询）。支持通过客户姓名搜索。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerName: { type: "string", description: "客户姓名" },
      customerId: { type: "string", description: "客户ID" },
      type: {
        type: "string",
        description: "预约类型：measure / install / revisit / consultation",
      },
      startAt: { type: "string", description: "开始时间，ISO 8601 格式" },
      endAt: { type: "string", description: "结束时间（可选）" },
      notes: { type: "string", description: "备注" },
      address: { type: "string", description: "地址" },
    },
    required: ["type", "startAt"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    let customerId = ctx.args.customerId as string | undefined;
    const customerName = ctx.args.customerName as string | undefined;

    if (!customerId && customerName) {
      const found = await db.salesCustomer.findFirst({
        where: { name: { contains: customerName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!found)
        return { success: false, data: { error: `未找到客户 "${customerName}"` } };
      customerId = found.id;
    }

    if (!customerId)
      return { success: false, data: { error: "请提供客户ID或客户姓名" } };

    const startAt = new Date(ctx.args.startAt as string);
    const endAt = ctx.args.endAt
      ? new Date(ctx.args.endAt as string)
      : new Date(startAt.getTime() + 60 * 60 * 1000);

    // 获取客户名构建标题
    const cust = await db.salesCustomer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });

    const typeLabels: Record<string, string> = {
      measure: "量房", install: "安装", revisit: "回访", consultation: "咨询",
    };
    const apptType = String(ctx.args.type);
    const title = `${cust?.name || "客户"} - ${typeLabels[apptType] || apptType}`;

    const appointment = await db.appointment.create({
      data: {
        customerId,
        type: apptType,
        title,
        status: "scheduled",
        startAt,
        endAt,
        address: (ctx.args.address as string) || null,
        notes: (ctx.args.notes as string) || null,
        assignedToId: ctx.userId,
        createdById: ctx.userId,
      },
    });

    // 同步到 Google Calendar
    const { syncAppointmentToGoogle } = await import(
      "@/lib/sales/appointment-gcal-sync"
    );
    syncAppointmentToGoogle(appointment.id, ctx.userId).catch(() => {});

    return ok({
      appointmentId: appointment.id,
      type: appointment.type,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
    });
  },
});

// ── sales.search_knowledge ──────────────────────────────────────

registry.register({
  name: "sales.search_knowledge",
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
  name: "sales.get_coaching",
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
      const customer = await db.salesCustomer.findFirst({
        where: {
          name: { contains: ctx.args.customerName as string, mode: "insensitive" },
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
  name: "sales.get_deal_health",
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
    if (!customerId && ctx.args.customerName) {
      const c = await db.salesCustomer.findFirst({
        where: { name: { contains: ctx.args.customerName as string, mode: "insensitive" } },
        select: { id: true },
      });
      customerId = c?.id;
    }
    if (!customerId) return { success: false, data: { error: "未找到客户" } };

    const oppWhere = ctx.args.opportunityId
      ? { id: ctx.args.opportunityId as string }
      : { customerId };

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

// ── sales.analyze_interaction ──────────────────────────────────

registry.register({
  name: "sales.analyze_interaction",
  description:
    "对一段销售沟通内容进行 AI 分析，提取意图/情绪/异议/买方信号/风险/下一步建议。" +
    "用于分析微信转发内容或销售问'帮我分析一下这段对话'。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "需要分析的沟通内容" },
      customerName: { type: "string", description: "客户姓名（可选，提高分析精度）" },
      dealStage: { type: "string", description: "当前 deal 阶段（可选）" },
    },
    required: ["content"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { analyzeCommunication } = await import(
      "@/lib/sales/communication-analyzer"
    );

    const content = ctx.args.content as string;
    if (!content || content.length < 10) {
      return { success: false, data: { error: "内容过短，无法分析" } };
    }

    try {
      const analysis = await analyzeCommunication({
        content,
        customerName: ctx.args.customerName as string | undefined,
        dealStage: ctx.args.dealStage as string | undefined,
      });

      return ok({
        sentiment: analysis.sentiment,
        intent: analysis.intent,
        objectionType: analysis.objectionType,
        dealHealthScore: analysis.dealHealthScore,
        buyerSignals: analysis.buyerSignals,
        riskSignals: analysis.riskSignals,
        keyNeeds: analysis.keyNeeds,
        suggestedNextAction: analysis.suggestedNextAction,
        summary: analysis.summary,
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "分析失败" },
      };
    }
  },
});

// ── sales.record_coaching ──────────────────────────────────────

registry.register({
  name: "sales.record_coaching",
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
    if (!customerId && ctx.args.customerName) {
      const c = await db.salesCustomer.findFirst({
        where: { name: { contains: ctx.args.customerName as string, mode: "insensitive" } },
        select: { id: true },
      });
      customerId = c?.id;
    }
    if (!customerId) return { success: false, data: { error: "未找到客户" } };

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
  name: "sales.coaching_feedback",
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

    try {
      await recordAdoption(
        ctx.args.recordId as string,
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

