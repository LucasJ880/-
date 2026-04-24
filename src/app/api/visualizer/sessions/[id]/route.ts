import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  validateSessionLinks,
} from "@/lib/visualizer/access";
import type {
  UpdateVisualizerSessionRequest,
  VisualizerSessionDetail,
  VisualizerSessionStatus,
} from "@/lib/visualizer/types";

const ALLOWED_STATUS: VisualizerSessionStatus[] = ["draft", "active", "archived"];

/**
 * GET /api/visualizer/sessions/[id]
 * 返回会话详情，包含图片与方案摘要（不含 region/productOption 明细，留给 PR #2）
 */
export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;

  const session = await db.visualizerSession.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, createdById: true } },
      opportunity: { select: { id: true, title: true, stage: true } },
      quote: { select: { id: true, version: true, status: true } },
      sourceImages: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { regions: true } } },
      },
      variants: {
        orderBy: { sortOrder: "asc" },
        include: {
          _count: { select: { productOptions: true } },
          selections: { select: { selectedBy: true } },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }

  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权访问该可视化方案" }, { status: 403 });
  }

  const detail: VisualizerSessionDetail = {
    id: session.id,
    title: session.title,
    status: session.status as VisualizerSessionStatus,
    customerId: session.customerId,
    customerName: session.customer.name,
    opportunityId: session.opportunityId,
    opportunityTitle: session.opportunity?.title ?? null,
    quoteId: session.quoteId,
    measurementRecordId: session.measurementRecordId,
    shareToken: session.shareToken,
    shareExpiresAt: session.shareExpiresAt?.toISOString() ?? null,
    createdById: session.createdById,
    salesOwnerId: session.salesOwnerId,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    counts: {
      sourceImages: session.sourceImages.length,
      variants: session.variants.length,
    },
    customer: { id: session.customer.id, name: session.customer.name },
    opportunity: session.opportunity
      ? {
          id: session.opportunity.id,
          title: session.opportunity.title,
          stage: session.opportunity.stage,
        }
      : null,
    quote: session.quote
      ? {
          id: session.quote.id,
          version: session.quote.version,
          status: session.quote.status,
        }
      : null,
    sourceImages: session.sourceImages.map((img) => ({
      id: img.id,
      fileUrl: img.fileUrl,
      fileName: img.fileName,
      mimeType: img.mimeType,
      width: img.width,
      height: img.height,
      roomLabel: img.roomLabel,
      createdAt: img.createdAt.toISOString(),
      regionCount: img._count.regions,
    })),
    variants: session.variants.map((v) => ({
      id: v.id,
      name: v.name,
      notes: v.notes,
      exportImageUrl: v.exportImageUrl,
      sortOrder: v.sortOrder,
      productOptionCount: v._count.productOptions,
      hasSalesSelection: v.selections.some((s) => s.selectedBy === "sales"),
      hasCustomerSelection: v.selections.some((s) => s.selectedBy === "customer"),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    })),
  };

  return NextResponse.json(detail);
});

/**
 * PATCH /api/visualizer/sessions/[id]
 * body: { title?, status?, salesOwnerId?, opportunityId?, quoteId?, measurementRecordId? }
 */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const body = await safeParseBody<UpdateVisualizerSessionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const session = await db.visualizerSession.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, createdById: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权修改该可视化方案" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const trimmed = body.title?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "title 不可为空" }, { status: 400 });
    }
    data.title = trimmed;
  }

  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json({ error: "status 非法" }, { status: 400 });
    }
    data.status = body.status;
  }

  if (body.salesOwnerId !== undefined) {
    data.salesOwnerId = body.salesOwnerId || null;
  }

  const wantsLinkChange =
    body.opportunityId !== undefined ||
    body.quoteId !== undefined ||
    body.measurementRecordId !== undefined;

  if (wantsLinkChange) {
    const linkCheck = await validateSessionLinks(session.customerId, {
      opportunityId:
        body.opportunityId !== undefined ? body.opportunityId : session.opportunityId,
      quoteId: body.quoteId !== undefined ? body.quoteId : session.quoteId,
      measurementRecordId:
        body.measurementRecordId !== undefined
          ? body.measurementRecordId
          : session.measurementRecordId,
    });
    if (!linkCheck.ok) {
      return NextResponse.json({ error: linkCheck.reason }, { status: linkCheck.status });
    }
    if (body.opportunityId !== undefined) data.opportunityId = body.opportunityId || null;
    if (body.quoteId !== undefined) data.quoteId = body.quoteId || null;
    if (body.measurementRecordId !== undefined) {
      data.measurementRecordId = body.measurementRecordId || null;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const updated = await db.visualizerSession.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      salesOwnerId: true,
      opportunityId: true,
      quoteId: true,
      measurementRecordId: true,
    },
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
    salesOwnerId: updated.salesOwnerId,
    opportunityId: updated.opportunityId,
    quoteId: updated.quoteId,
    measurementRecordId: updated.measurementRecordId,
  });
});
