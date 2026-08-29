import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import type { UpdateVariantRequest } from "@/lib/visualizer/types";
import { summarizeRenderJob } from "@/lib/visualizer/render-job";

/**
 * GET /api/visualizer/variants/[variantId]
 * 轻量轮询端点：异步 HD 渲染的状态 + 最新效果图地址。
 */
export const GET = withAuth(async (_request, ctx, user) => {
  const { variantId } = await ctx.params;

  const found = await loadSessionByVariant(variantId);
  if (!found) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权查看该方案" }, { status: 403 });
  }

  const variant = await db.visualizerVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      exportImageUrl: true,
      updatedAt: true,
      renderJobStatus: true,
      renderJobQuality: true,
      renderJobError: true,
      renderJobStartedAt: true,
    },
  });
  if (!variant) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }

  return NextResponse.json({
    id: variant.id,
    exportImageUrl: variant.exportImageUrl,
    updatedAt: variant.updatedAt.toISOString(),
    renderJob: summarizeRenderJob(variant, Date.now()),
  });
});

/** PATCH /api/visualizer/variants/[variantId] */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;

  const found = await loadSessionByVariant(variantId);
  if (!found) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<UpdateVariantRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = body.name?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "name 不可为空" }, { status: 400 });
    }
    data.name = trimmed;
  }
  if (body.notes !== undefined) {
    data.notes = body.notes?.trim() || null;
  }
  if (body.sortOrder !== undefined) {
    if (typeof body.sortOrder !== "number" || !Number.isFinite(body.sortOrder)) {
      return NextResponse.json({ error: "sortOrder 非法" }, { status: 400 });
    }
    data.sortOrder = body.sortOrder;
  }
  if (body.exportImageUrl !== undefined) {
    data.exportImageUrl = body.exportImageUrl || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const updated = await db.visualizerVariant.update({
    where: { id: variantId },
    data,
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    variant: {
      id: updated.id,
      name: updated.name,
      notes: updated.notes,
      sortOrder: updated.sortOrder,
      exportImageUrl: updated.exportImageUrl,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

/** DELETE /api/visualizer/variants/[variantId] */
export const DELETE = withAuth(async (_request, ctx, user) => {
  const { variantId } = await ctx.params;

  const found = await loadSessionByVariant(variantId);
  if (!found) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权删除该方案" }, { status: 403 });
  }

  await db.visualizerVariant.delete({ where: { id: variantId } });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
