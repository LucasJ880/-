import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import type { UpdateVariantRequest } from "@/lib/visualizer/types";

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
