import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  SESSION_ACCESS_SELECT,
  canSeeVisualizerSession,
} from "@/lib/visualizer/access";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import {
  VISUALIZER_ALLOWED_IMAGE_EXTS,
  VISUALIZER_ALLOWED_MIME,
  VISUALIZER_MAX_IMAGE_SIZE,
  parseImageSize,
  putVisualizerImage,
} from "@/lib/visualizer/upload";
import { logger } from "@/lib/common/logger";

/**
 * POST /api/visualizer/sessions/[id]/images
 * multipart/form-data
 *   - file: 图片
 *   - roomLabel?: string
 *   - note?: string
 *   - measurementPhotoId?: string  （弱耦合回链）
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id: sessionId } = await ctx.params;

  const session = await db.visualizerSession.findUnique({
    where: { id: sessionId },
    select: SESSION_ACCESS_SELECT,
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该可视化方案" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "请求格式无效，需要 multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "未上传文件" }, { status: 400 });
  }

  const check = await validateUploadedFileAsync(file, {
    maxSize: VISUALIZER_MAX_IMAGE_SIZE,
    allowedExtensions: [...VISUALIZER_ALLOWED_IMAGE_EXTS],
    allowedMimeTypes: VISUALIZER_ALLOWED_MIME,
    checkMagicBytes: true,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const { buffer, safeName, size, mime, ext } = check;
  const dims = parseImageSize(buffer, ext);

  const roomLabel = (formData.get("roomLabel") as string | null)?.trim() || null;
  const note = (formData.get("note") as string | null)?.trim() || null;
  const measurementPhotoId =
    (formData.get("measurementPhotoId") as string | null)?.trim() || null;

  let fileUrl: string;
  try {
    const blob = await putVisualizerImage({
      sessionId,
      safeName,
      buffer,
      contentType: mime,
    });
    fileUrl = blob.url;
  } catch (err) {
    logger.error("visualizer.image.upload_failed", { err, sessionId });
    return NextResponse.json({ error: "图片上传失败，请稍后重试" }, { status: 500 });
  }

  const created = await db.visualizerSourceImage.create({
    data: {
      sessionId,
      fileUrl,
      fileName: safeName,
      mimeType: mime,
      bytes: size,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      roomLabel,
      note,
      measurementPhotoId,
    },
  });

  await db.visualizerSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(
    {
      image: {
        id: created.id,
        fileUrl: created.fileUrl,
        fileName: created.fileName,
        mimeType: created.mimeType,
        width: created.width,
        height: created.height,
        roomLabel: created.roomLabel,
        createdAt: created.createdAt.toISOString(),
        regionCount: 0,
        regions: [],
      },
    },
    { status: 201 },
  );
});
