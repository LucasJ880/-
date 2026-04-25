import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionBySourceImage,
} from "@/lib/visualizer/access";
import { fetchBuffer, runImageEdit } from "@/lib/visualizer/image-ai";
import { createTransparentEditMaskPng } from "@/lib/visualizer/png-mask";
import {
  parseImageSize,
  putVisualizerCleanedImage,
} from "@/lib/visualizer/upload";
import type { VisualizerRegionShape } from "@/lib/visualizer/types";

type CleanBody = { regionId?: string; instruction?: string };
const MAX_MASK_PIXELS = 8_000_000;

export const POST = withAuth(async (request, ctx, user) => {
  const { imageId } = await ctx.params;
  const session = await loadSessionBySourceImage(imageId);
  if (!session) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该图片" }, { status: 403 });
  }

  const body = await safeParseBody<CleanBody>(request);
  if (!body?.regionId) {
    return NextResponse.json({ error: "请先选择要清理的窗户区域" }, { status: 400 });
  }

  const image = await db.visualizerSourceImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      sessionId: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      width: true,
      height: true,
      roomLabel: true,
      regions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          shape: true,
          pointsJson: true,
          label: true,
          widthIn: true,
          heightIn: true,
          measurementWindowId: true,
        },
      },
    },
  });
  if (!image || image.sessionId !== session.id) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  if (!image.width || !image.height) {
    return NextResponse.json({ error: "图片缺少尺寸信息，无法清理" }, { status: 400 });
  }
  if (image.width * image.height > MAX_MASK_PIXELS) {
    return NextResponse.json(
      { error: "图片过大，暂不支持 AI 清理。请先上传较小图片。" },
      { status: 400 },
    );
  }

  const region = image.regions.find((r) => r.id === body.regionId);
  if (!region) return NextResponse.json({ error: "窗户区域不存在" }, { status: 404 });
  const points = Array.isArray(region.pointsJson)
    ? (region.pointsJson as Array<[number, number]>)
    : [];
  if (points.length < 2) {
    return NextResponse.json({ error: "窗户区域坐标无效" }, { status: 400 });
  }

  const originalBuffer = await fetchBuffer(image.fileUrl);
  if (!originalBuffer) return NextResponse.json({ error: "原图下载失败" }, { status: 502 });

  const prompt =
    typeof body.instruction === "string" && body.instruction.trim()
      ? body.instruction.trim().slice(0, 300)
      : "Remove old curtains, blinds, clutter, and obstructions only inside the transparent mask area. Reconstruct a clean natural window/glass/wall background. Preserve room perspective, lighting, shadows, wall color, window frame, and photo realism. Do not add new window coverings.";

  const maskBuffer = createTransparentEditMaskPng({
    width: image.width,
    height: image.height,
    shape: region.shape as VisualizerRegionShape,
    points,
  });
  const editedBuffer = await runImageEdit({
    imageBuffer: originalBuffer,
    imageMime: image.mimeType,
    maskBuffer,
    prompt,
  });
  if (!editedBuffer) {
    return NextResponse.json({ error: "AI 清理失败，请稍后重试" }, { status: 502 });
  }

  const dims = parseImageSize(editedBuffer, "png");
  const uploaded = await putVisualizerCleanedImage({
    sessionId: image.sessionId,
    sourceImageId: image.id,
    buffer: editedBuffer,
    contentType: "image/png",
  });
  const created = await db.visualizerSourceImage.create({
    data: {
      sessionId: image.sessionId,
      fileUrl: uploaded.url,
      fileName: `${image.fileName.replace(/\.[^.]+$/, "")}_ai_cleaned.png`,
      mimeType: "image/png",
      bytes: editedBuffer.length,
      width: dims?.width ?? image.width,
      height: dims?.height ?? image.height,
      roomLabel: image.roomLabel ? `${image.roomLabel}（AI清理）` : "AI清理图",
      note: `AI cleaned from source image ${image.id}`,
    },
  });

  const sameSize =
    (dims?.width ?? image.width) === image.width &&
    (dims?.height ?? image.height) === image.height;
  if (sameSize) {
    await db.visualizerWindowRegion.createMany({
      data: image.regions.map((r) => ({
        sourceImageId: created.id,
        shape: r.shape,
        pointsJson: r.pointsJson as Prisma.InputJsonValue,
        label: r.label,
        widthIn: r.widthIn,
        heightIn: r.heightIn,
        measurementWindowId: r.measurementWindowId,
      })),
    });
  }

  await db.visualizerSession.update({
    where: { id: image.sessionId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    image: {
      id: created.id,
      fileUrl: created.fileUrl,
      fileName: created.fileName,
      mimeType: created.mimeType,
      width: created.width,
      height: created.height,
      roomLabel: created.roomLabel,
      createdAt: created.createdAt.toISOString(),
      regionCount: sameSize ? image.regions.length : 0,
      regions: [],
    },
    copiedRegions: sameSize ? image.regions.length : 0,
  });
});
