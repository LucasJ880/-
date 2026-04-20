/**
 * 销售域工具 — 客户管理
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { ok } from "./sales-helpers";
import { salesCreatedScope, canSeeResource } from "@/lib/rbac/data-scope";

// ── sales.search_customers ──────────────────────────────────────

registry.register({
  name: "sales_search_customers",
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

    const ownerScope = salesCreatedScope(ctx.userId, ctx.role);
    const where: Record<string, unknown> = {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
        { email: { contains: query, mode: "insensitive" } },
      ],
      // 不让 AI 把已归档的客户列出来
      archivedAt: null,
      ...(ownerScope ?? {}),
    };

    const customers = await db.salesCustomer.findMany({
      where,
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
  name: "sales_get_customer",
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

    // 已归档客户：AI 无法继续操作
    if ((customer as { archivedAt?: Date | null }).archivedAt) {
      return { success: false, data: { error: "客户已归档，无法访问" } };
    }

    // PR1：防止跨销售窥探他人客户
    if (!canSeeResource(ctx.role, ctx.userId, { createdById: customer.createdById })) {
      return { success: false, data: { error: "无权访问该客户" } };
    }

    return ok(customer);
  },
});
