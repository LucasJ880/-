/**
 * 销售域工具 — 报价管理
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { parseGptQuotePlan, parseLocalQuotePlan } from "@/lib/sales/ai-quote-parser";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import type { ProductName } from "@/lib/blinds/pricing-types";
import { onQuoteCreated } from "@/lib/sales/opportunity-lifecycle";
import { ok } from "./sales-helpers";
import { canSeeResource } from "@/lib/rbac/data-scope";
import { assertSalesCustomerInOrgOrThrowForConvert } from "@/lib/sales/org-context";

// ── sales.ai_quote ──────────────────────────────────────────

registry.register({
  name: "sales_ai_quote",
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
  name: "sales_create_quote",
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
        product: i.product as ProductName,
        fabric: i.fabric,
        widthIn: i.widthIn,
        heightIn: i.heightIn,
      })),
      installMode: installMode === "pickup" ? "pickup" : "default",
    });

    if (calc.itemResults.length === 0) {
      return { success: false, data: { error: "所有产品项计算失败", details: calc.errors } };
    }

    const customerRow = await db.salesCustomer.findFirst({
      where: { id: customerId, archivedAt: null },
      select: { id: true, orgId: true, createdById: true },
    });
    if (!customerRow) {
      return { success: false, data: { error: "客户不存在" } };
    }
    try {
      await assertSalesCustomerInOrgOrThrowForConvert(customerRow, ctx.orgId);
    } catch (e) {
      return {
        success: false,
        data: { error: e instanceof Error ? e.message : "客户组织校验失败" },
      };
    }

    if (opportunityId) {
      const opp = await db.salesOpportunity.findFirst({
        where: { id: opportunityId, customerId },
        select: { id: true, orgId: true },
      });
      if (!opp) {
        return { success: false, data: { error: "商机不存在或不属于该客户" } };
      }
      if (opp.orgId && opp.orgId !== ctx.orgId) {
        return { success: false, data: { error: "商机不属于当前组织" } };
      }
    }

    const existingCount = await db.salesQuote.count({ where: { customerId } });

    const quote = await db.salesQuote.create({
      data: {
        orgId: ctx.orgId,
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
  name: "sales_get_customer_quotes",
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

    // PR1：先验证当前角色对该客户的可见性（admin 跳过）
    const customer = await db.salesCustomer.findUnique({
      where: { id: customerId },
      select: { id: true, createdById: true, name: true, email: true },
    });
    if (!customer) {
      return { success: false, data: { error: "客户不存在" } };
    }
    if (!canSeeResource(ctx.role, ctx.userId, { createdById: customer.createdById })) {
      return { success: false, data: { error: "无权访问该客户的报价" } };
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
