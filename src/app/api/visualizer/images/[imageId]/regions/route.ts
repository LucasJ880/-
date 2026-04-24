import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionBySourceImage,
} from "@/lib/visualizer/access";
import {
  VISUALIZER_REGION_SHAPES,
  validateRegionPoints,
} from "@/lib/visualizer/validators";
import type {
  CreateRegionRequest,
  VisualizerRegionShape,
  VisualizerWindowRegionDetail,
} from "@/lib/visualizer/types";

/**
 * POST /api/visualizer/images/[imageId]/regions
 * body: { shape, points, label?, widthIn?, heightIn?, measurementWindowId? }
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { imageId } = await ctx.params;

  const session = await loadSessionBySourceImage(imageId);
  if (!session) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该图片" }, { status: 403 });
  }

  const body = await safeParseBody<CreateRegionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  if (!VISUALIZER_REGION_SHAPES.includes(body.shape)) {
    return NextResponse.json({ error: "shape 非法" }, { status: 400 });
  }
  const ptsCheck = validateRegionPoints(body.shape, body.points);
  if (!ptsCheck.ok) {
    return NextResponse.json({ error: ptsCheck.reason }, { status: 400 });
  }

  const created = await db.visualizerWindowRegion.create({
    data: {
      sourceImageId: imageId,
      shape: body.shape,
      pointsJson: ptsCheck.points,
      label: body.label?.trim() || null,
      widthIn:
        typeof body.widthIn === "number" && Number.isFinite(body.widthIn)
          ? body.widthIn
          : null,
      heightIn:
        typeof body.heightIn === "number" && Number.isFinite(body.heightIn)
          ? body.heightIn
          : null,
      measurementWindowId: body.measurementWindowId?.trim() || null,
    },
  });
  await db.visualizerSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });

  const detail: VisualizerWindowRegionDetail = {
    id: created.id,
    sourceImageId: created.sourceImageId,
    measurementWindowId: created.measurementWindowId,
    label: created.label,
    shape: created.shape as VisualizerRegionShape,
    points: ptsCheck.points,
    widthIn: created.widthIn,
    heightIn: created.heightIn,
    createdAt: created.createdAt.toISOString(),
  };
  return NextResponse.json({ region: detail }, { status: 201 });
});
