import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByRegion,
} from "@/lib/visualizer/access";
import {
  VISUALIZER_REGION_SHAPES,
  validateRegionPoints,
} from "@/lib/visualizer/validators";
import type {
  UpdateRegionRequest,
  VisualizerRegionShape,
  VisualizerWindowRegionDetail,
} from "@/lib/visualizer/types";

/**
 * PATCH /api/visualizer/regions/[regionId]
 * body: { shape?, points?, label?, widthIn?, heightIn?, measurementWindowId? }
 */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { regionId } = await ctx.params;

  const found = await loadSessionByRegion(regionId);
  if (!found) {
    return NextResponse.json({ error: "窗户区域不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该窗户区域" }, { status: 403 });
  }

  const body = await safeParseBody<UpdateRegionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  let nextShape: VisualizerRegionShape | undefined;
  let nextPoints: Array<[number, number]> | undefined;

  if (body.shape !== undefined) {
    if (!VISUALIZER_REGION_SHAPES.includes(body.shape)) {
      return NextResponse.json({ error: "shape 非法" }, { status: 400 });
    }
    data.shape = body.shape;
    nextShape = body.shape;
  }
  if (body.points !== undefined) {
    const existing = await db.visualizerWindowRegion.findUnique({
      where: { id: regionId },
      select: { shape: true },
    });
    const shape = (nextShape ?? (existing?.shape === "rect" ? "rect" : "polygon")) as VisualizerRegionShape;
    const ptsCheck = validateRegionPoints(shape, body.points);
    if (!ptsCheck.ok) {
      return NextResponse.json({ error: ptsCheck.reason }, { status: 400 });
    }
    data.pointsJson = ptsCheck.points;
    nextPoints = ptsCheck.points;
  }
  if (body.label !== undefined) {
    data.label = body.label?.trim() || null;
  }
  if (body.widthIn !== undefined) {
    data.widthIn =
      typeof body.widthIn === "number" && Number.isFinite(body.widthIn)
        ? body.widthIn
        : null;
  }
  if (body.heightIn !== undefined) {
    data.heightIn =
      typeof body.heightIn === "number" && Number.isFinite(body.heightIn)
        ? body.heightIn
        : null;
  }
  if (body.measurementWindowId !== undefined) {
    data.measurementWindowId = body.measurementWindowId?.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const updated = await db.visualizerWindowRegion.update({
    where: { id: regionId },
    data,
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  const detail: VisualizerWindowRegionDetail = {
    id: updated.id,
    sourceImageId: updated.sourceImageId,
    measurementWindowId: updated.measurementWindowId,
    label: updated.label,
    shape: updated.shape as VisualizerRegionShape,
    points:
      nextPoints ??
      (Array.isArray(updated.pointsJson)
        ? (updated.pointsJson as unknown as Array<[number, number]>)
        : []),
    widthIn: updated.widthIn,
    heightIn: updated.heightIn,
    createdAt: updated.createdAt.toISOString(),
  };

  return NextResponse.json({ region: detail });
});

/** DELETE /api/visualizer/regions/[regionId] */
export const DELETE = withAuth(async (_request, ctx, user) => {
  const { regionId } = await ctx.params;

  const found = await loadSessionByRegion(regionId);
  if (!found) {
    return NextResponse.json({ error: "窗户区域不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权删除该窗户区域" }, { status: 403 });
  }

  await db.visualizerWindowRegion.delete({ where: { id: regionId } });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
