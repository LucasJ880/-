import { NextResponse } from "next/server";
import { withAuth, queryString, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  visualizerSessionListScope,
  validateCustomerAccessForCreate,
  validateSessionLinks,
} from "@/lib/visualizer/access";
import type {
  CreateVisualizerSessionRequest,
  VisualizerSessionSummary,
} from "@/lib/visualizer/types";

/**
 * GET /api/visualizer/sessions?customerId=&opportunityId=&quoteId=
 * 列出当前用户可见的 session（默认按更新时间倒序）
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const customerId = queryString(request, "customerId");
  const opportunityId = queryString(request, "opportunityId");
  const quoteId = queryString(request, "quoteId");

  const scope = visualizerSessionListScope(user);
  const where: Record<string, unknown> = {
    ...(scope ?? {}),
  };
  if (customerId) where.customerId = customerId;
  if (opportunityId) where.opportunityId = opportunityId;
  if (quoteId) where.quoteId = quoteId;

  const sessions = await db.visualizerSession.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, title: true } },
      _count: { select: { sourceImages: true, variants: true } },
    },
  });

  const summaries: VisualizerSessionSummary[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status as VisualizerSessionSummary["status"],
    customerId: s.customerId,
    customerName: s.customer.name,
    opportunityId: s.opportunityId,
    opportunityTitle: s.opportunity?.title ?? null,
    quoteId: s.quoteId,
    createdById: s.createdById,
    salesOwnerId: s.salesOwnerId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    counts: {
      sourceImages: s._count.sourceImages,
      variants: s._count.variants,
    },
  }));

  return NextResponse.json({ sessions: summaries });
});

/**
 * POST /api/visualizer/sessions
 * body: { customerId, title?, opportunityId?, quoteId?, measurementRecordId? }
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await safeParseBody<CreateVisualizerSessionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  if (!body.customerId || typeof body.customerId !== "string") {
    return NextResponse.json({ error: "customerId 必填" }, { status: 400 });
  }

  const customerCheck = await validateCustomerAccessForCreate(body.customerId, user);
  if (!customerCheck.ok) {
    return NextResponse.json({ error: customerCheck.reason }, { status: customerCheck.status });
  }

  const linkCheck = await validateSessionLinks(body.customerId, {
    opportunityId: body.opportunityId ?? null,
    quoteId: body.quoteId ?? null,
    measurementRecordId: body.measurementRecordId ?? null,
  });
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.reason }, { status: linkCheck.status });
  }

  const title = body.title?.trim() || `${customerCheck.customer.name} 的可视化方案`;

  const created = await db.visualizerSession.create({
    data: {
      customerId: body.customerId,
      title,
      opportunityId: body.opportunityId || null,
      quoteId: body.quoteId || null,
      measurementRecordId: body.measurementRecordId || null,
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

  return NextResponse.json({ session: summary }, { status: 201 });
});
