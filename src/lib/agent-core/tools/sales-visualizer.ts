/**
 * 销售域工具 — Visualizer（窗饰可视化方案）
 *
 * sales_visualizer_open：
 * 让 AI 在对话里为指定客户 / 机会幂等打开一个 Visualizer 方案。
 * - 同一 (customerId, opportunityId?) 已有非 archived 方案 → 直接返回最新一个
 * - 否则新建（复用 Visualizer 模块已有的校验链路）
 *
 * 典型触发语：
 * - "给张先生看看不同颜色的百叶效果图"
 * - "帮我给客户 Lucas 开一个可视化方案"
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { ok } from "./sales-helpers";
import { salesCreatedScope } from "@/lib/rbac/data-scope";
import {
  canSeeVisualizerSession,
  validateCustomerAccessForCreate,
  validateSessionLinks,
} from "@/lib/visualizer/access";

registry.register({
  name: "sales_visualizer_open",
  description:
    "为指定销售客户（可选 opportunity）打开窗饰可视化方案；已存在则复用，不存在则新建。返回可直接点击的 URL。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID，优先" },
      customerName: {
        type: "string",
        description: "客户姓名，用于 customerId 缺失时搜索；命中多个或零个都会直接报错让 AI 追问",
      },
      opportunityId: {
        type: "string",
        description: "可选：销售机会 ID，指定后只与该机会关联的方案做匹配",
      },
      title: { type: "string", description: "可选：新建时的方案标题" },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const customerId = ctx.args.customerId ? String(ctx.args.customerId) : null;
    const customerName = ctx.args.customerName
      ? String(ctx.args.customerName)
      : null;
    const opportunityId = ctx.args.opportunityId
      ? String(ctx.args.opportunityId)
      : null;
    const title = ctx.args.title ? String(ctx.args.title).trim() : undefined;

    // 1) 解析 customer
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && customerName) {
      const ownerScope = salesCreatedScope(ctx.userId, ctx.role);
      const hits = await db.salesCustomer.findMany({
        where: {
          name: { contains: customerName, mode: "insensitive" },
          archivedAt: null,
          ...(ownerScope ?? {}),
        },
        select: { id: true, name: true, phone: true, email: true },
        take: 5,
      });
      if (hits.length === 0) {
        return {
          success: false,
          data: { error: `未找到名称包含 "${customerName}" 的客户` },
        };
      }
      if (hits.length > 1) {
        return {
          success: false,
          data: {
            error: "客户名称匹配多条，请先确认",
            candidates: hits,
            hint: "请用 sales_search_customers 确认后重试，或直接提供 customerId",
          },
        };
      }
      resolvedCustomerId = hits[0].id;
    }
    if (!resolvedCustomerId) {
      return {
        success: false,
        data: { error: "请提供 customerId 或 customerName" },
      };
    }

    // 2) 校验客户可见性
    const customerCheck = await validateCustomerAccessForCreate(
      resolvedCustomerId,
      { id: ctx.userId, role: ctx.role },
    );
    if (!customerCheck.ok) {
      return { success: false, data: { error: customerCheck.reason } };
    }

    // 3) 找已有 session
    const existing = await db.visualizerSession.findFirst({
      where: {
        customerId: resolvedCustomerId,
        status: { not: "archived" },
        opportunityId: opportunityId ?? null,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, createdById: true } },
        opportunity: { select: { id: true, title: true } },
      },
    });

    if (
      existing &&
      canSeeVisualizerSession(existing, { id: ctx.userId, role: ctx.role })
    ) {
      return ok({
        sessionId: existing.id,
        url: `/sales/visualizer/${existing.id}`,
        created: false,
        customer: { id: existing.customer.id, name: existing.customer.name },
        opportunity: existing.opportunity,
        title: existing.title,
      });
    }

    // 4) 新建（受 validateSessionLinks 保护）
    const linkCheck = await validateSessionLinks(resolvedCustomerId, {
      opportunityId,
      quoteId: null,
      measurementRecordId: null,
    });
    if (!linkCheck.ok) {
      return { success: false, data: { error: linkCheck.reason } };
    }

    const created = await db.visualizerSession.create({
      data: {
        customerId: resolvedCustomerId,
        title: title || `${customerCheck.customer.name} 的可视化方案`,
        opportunityId: opportunityId ?? null,
        createdById: ctx.userId,
        salesOwnerId: ctx.userId,
      },
      include: {
        customer: { select: { id: true, name: true } },
        opportunity: { select: { id: true, title: true } },
      },
    });

    return ok({
      sessionId: created.id,
      url: `/sales/visualizer/${created.id}`,
      created: true,
      customer: { id: created.customer.id, name: created.customer.name },
      opportunity: created.opportunity,
      title: created.title,
    });
  },
});
