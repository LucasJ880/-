import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  validateCustomerAccessForCreate,
  validateSessionLinks,
} from "@/lib/visualizer/access";
import type { VisualizerSessionSummary } from "@/lib/visualizer/types";

/**
 * POST /api/visualizer/sessions/open
 *
 * 幂等打开一个 Visualizer 方案。
 * - 有 (customerId, opportunityId?) 匹配的**非 archived** session → 返回最新一个
 * - 没有 → 复用 POST /sessions 的同款校验创建一个新 session
 * - opportunityId 提供时严格匹配；不提供时，匹配 opportunityId IS NULL 的 session
 *
 * Body: { customerId: string; opportunityId?: string; quoteId?: string; measurementRecordId?: string; title?: string }
 * Returns: { session: VisualizerSessionSummary; created: boolean }
 *
 * 设计动机：销售 opportunity 列表点"可视化方案"、AI 工具 sales_visualizer_open
 * 都期望"同一机会下只长出一套方案"，而不是每次点都新建一条。
 */
interface OpenBody {
  customerId?: string;
  opportunityId?: string | null;
  quoteId?: string | null;
  measurementRecordId?: string | null;
  title?: string;
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await safeParseBody<OpenBody>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const customerId = body.customerId?.trim();
  if (!customerId) {
    return NextResponse.json({ error: "customerId 必填" }, { status: 400 });
  }

  const customerCheck = await validateCustomerAccessForCreate(customerId, user);
  if (!customerCheck.ok) {
    return NextResponse.json({ error: customerCheck.reason }, { status: customerCheck.status });
  }

  // 1) 先找复用目标
  const existing = await db.visualizerSession.findFirst({
    where: {
      customerId,
      status: { not: "archived" },
      opportunityId: body.opportunityId ?? null,
    },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, createdById: true } },
      opportunity: { select: { id: true, title: true } },
      _count: { select: { sourceImages: true, variants: true } },
    },
  });

  if (existing && canSeeVisualizerSession(existing, user)) {
    const summary: VisualizerSessionSummary = {
      id: existing.id,
      title: existing.title,
      status: existing.status as VisualizerSessionSummary["status"],
      customerId: existing.customerId,
      customerName: existing.customer.name,
      opportunityId: existing.opportunityId,
      opportunityTitle: existing.opportunity?.title ?? null,
      quoteId: existing.quoteId,
      createdById: existing.createdById,
      salesOwnerId: existing.salesOwnerId,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: existing.updatedAt.toISOString(),
      counts: {
        sourceImages: existing._count.sourceImages,
        variants: existing._count.variants,
      },
    };
    return NextResponse.json({ session: summary, created: false });
  }

  // 2) 创建新 session（复用 POST /sessions 的同款链路校验）
  const linkCheck = await validateSessionLinks(customerId, {
    opportunityId: body.opportunityId ?? null,
    quoteId: body.quoteId ?? null,
    measurementRecordId: body.measurementRecordId ?? null,
  });
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.reason }, { status: linkCheck.status });
  }

  const title =
    body.title?.trim() || `${customerCheck.customer.name} 的可视化方案`;

  const created = await db.visualizerSession.create({
    data: {
      customerId,
      title,
      opportunityId: body.opportunityId ?? null,
      quoteId: body.quoteId ?? null,
      measurementRecordId: body.measurementRecordId ?? null,
      createdById: user.id,
      salesOwnerId: user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, title: true } },
      _count: { select: { sourceImages: true, variants: true } },
    },
  });

  const summary: VisualizerSessionSummary = {
    id: created.id,
    title: created.title,
    status: created.status as VisualizerSessionSummary["status"],
    customerId: created.customerId,
    customerName: created.customer.name,
    opportunityId: created.opportunityId,
    opportunityTitle: created.opportunity?.title ?? null,
    quoteId: created.quoteId,
    createdById: created.createdById,
    salesOwnerId: created.salesOwnerId,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    counts: {
      sourceImages: created._count.sourceImages,
      variants: created._count.variants,
    },
  };
  return NextResponse.json({ session: summary, created: true }, { status: 201 });
});
