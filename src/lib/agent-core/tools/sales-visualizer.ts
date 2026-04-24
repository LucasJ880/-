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
  visualizerSessionListScope,
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

/**
 * sales_visualizer_list_covers：
 *
 * 只读工具。让 AI 能在对话里列出某客户 / 销售机会下已有的 Visualizer 方案封面，
 * 用于回答 "客户 Lucas 的方案效果图现在有哪些？"、"把上次给他看的卧室方案
 * 封面发我" 之类的问题。
 *
 * 为什么没有 "export_cover"：
 *   真正把当前画布"拍封面"依赖浏览器里的 Konva Stage，服务端无法代渲染。
 *   所以 AI 只能列已经被用户导出过的封面，要新建封面请在画布页点「保存为方案封面」。
 */
registry.register({
  name: "sales_visualizer_list_covers",
  description:
    "列出指定客户（可选 opportunity）名下已导出的窗饰方案封面；每个 session 返回所有非空 exportImageUrl 的 variants。不做新的导出，只是汇总已有的效果图。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID，优先使用" },
      customerName: {
        type: "string",
        description: "客户姓名，用于 customerId 缺失时搜索；命中多个或零个会直接报错让 AI 追问",
      },
      opportunityId: {
        type: "string",
        description: "可选：只看该销售机会下的方案",
      },
      onlyWithCover: {
        type: "boolean",
        description: "默认 true：只返回至少已有一个 exportImageUrl 的 session",
      },
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
    const onlyWithCover =
      ctx.args.onlyWithCover === undefined ? true : Boolean(ctx.args.onlyWithCover);

    // 解析 customer（同 open 工具的路径）
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

    // 可见性：有些 sales 不是客户创建人，但可能是 session 的 owner；
    // 所以不强制客户可见性前置校验，直接走 visualizerSessionListScope 过滤
    const scope = visualizerSessionListScope({ id: ctx.userId, role: ctx.role });

    const sessions = await db.visualizerSession.findMany({
      where: {
        customerId: resolvedCustomerId,
        status: { not: "archived" },
        ...(opportunityId ? { opportunityId } : {}),
        ...(scope ?? {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        opportunity: { select: { id: true, title: true } },
        variants: {
          where: onlyWithCover ? { exportImageUrl: { not: null } } : undefined,
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            sortOrder: true,
            exportImageUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    const filtered = onlyWithCover
      ? sessions.filter((s) => s.variants.length > 0)
      : sessions;

    return ok({
      customerId: resolvedCustomerId,
      total: filtered.length,
      sessions: filtered.map((s) => ({
        sessionId: s.id,
        title: s.title,
        url: `/sales/visualizer/${s.id}`,
        opportunity: s.opportunity,
        updatedAt: s.updatedAt.toISOString(),
        variants: s.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sortOrder: v.sortOrder,
          exportImageUrl: v.exportImageUrl,
          updatedAt: v.updatedAt.toISOString(),
        })),
      })),
      hint: onlyWithCover
        ? "仅列出已有封面的方案。若要新建封面，请在画布页面点『保存为方案封面』。"
        : "已包含暂无封面的方案。若要新建封面，请在画布页面点『保存为方案封面』。",
    });
  },
});
