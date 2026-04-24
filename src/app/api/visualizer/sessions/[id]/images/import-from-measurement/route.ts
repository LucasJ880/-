import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  SESSION_ACCESS_SELECT,
  canSeeVisualizerSession,
} from "@/lib/visualizer/access";
import type { VisualizerSourceImageSummary } from "@/lib/visualizer/types";

/**
 * POST /api/visualizer/sessions/[id]/images/import-from-measurement
 *
 * 从量房记录把已有 MeasurementPhoto 一键导入到 Visualizer，
 * 通过弱耦合 measurementPhotoId 回链，不重复写 blob。
 *
 * Body: { measurementRecordId?: string; windowIds?: string[] }
 * - measurementRecordId 可省略，默认用 session.measurementRecordId
 * - windowIds 非空时只导入这些窗位下的照片，否则导入该 record 所有窗位
 *
 * 去重：已存在相同 measurementPhotoId 的 session image 会被跳过。
 */
interface ImportBody {
  measurementRecordId?: string;
  windowIds?: string[];
}

export const POST = withAuth(async (request, ctx, user) => {
  const { id: sessionId } = await ctx.params;

  const session = await db.visualizerSession.findUnique({
    where: { id: sessionId },
    select: { ...SESSION_ACCESS_SELECT, measurementRecordId: true },
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该可视化方案" }, { status: 403 });
  }

  const body = await safeParseBody<ImportBody>(request);
  const measurementRecordId =
    body?.measurementRecordId?.trim() || session.measurementRecordId;
  if (!measurementRecordId) {
    return NextResponse.json(
      { error: "未指定 measurementRecordId，且当前方案未绑定量房记录" },
      { status: 400 },
    );
  }

  // 量房记录必须属于同一客户
  const record = await db.measurementRecord.findUnique({
    where: { id: measurementRecordId },
    select: {
      id: true,
      customerId: true,
      windows: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          roomName: true,
          windowLabel: true,
          widthIn: true,
          heightIn: true,
          photos: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  if (!record) {
    return NextResponse.json({ error: "量房记录不存在" }, { status: 404 });
  }
  if (record.customerId !== session.customerId) {
    return NextResponse.json(
      { error: "量房记录与该方案的客户不匹配" },
      { status: 400 },
    );
  }

  // 若前端指定了 windowIds，则只导入这些窗的照片
  const wantedWindowIds =
    Array.isArray(body?.windowIds) && body.windowIds.length > 0
      ? new Set(body.windowIds.map((x) => String(x)))
      : null;

  // 把要导入的 photo 摊平
  const incomingPhotos: Array<{
    id: string;
    fileName: string;
    fileUrl: string;
    roomLabel: string | null;
  }> = [];
  for (const win of record.windows) {
    if (wantedWindowIds && !wantedWindowIds.has(win.id)) continue;
    for (const photo of win.photos) {
      const roomLabel = win.windowLabel
        ? `${win.roomName} · ${win.windowLabel}`
        : win.roomName;
      incomingPhotos.push({
        id: photo.id,
        fileName: photo.fileName,
        fileUrl: photo.fileUrl,
        roomLabel,
      });
    }
  }

  if (incomingPhotos.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: 0,
      images: [],
    });
  }

  // 去重：已有的 measurementPhotoId
  const existing = await db.visualizerSourceImage.findMany({
    where: {
      sessionId,
      measurementPhotoId: { in: incomingPhotos.map((p) => p.id) },
    },
    select: { measurementPhotoId: true },
  });
  const existingSet = new Set(
    existing.map((e) => e.measurementPhotoId).filter(Boolean) as string[],
  );
  const toCreate = incomingPhotos.filter((p) => !existingSet.has(p.id));

  // 批量创建
  const created = await Promise.all(
    toCreate.map((p) =>
      db.visualizerSourceImage.create({
        data: {
          sessionId,
          measurementPhotoId: p.id,
          fileUrl: p.fileUrl,
          fileName: p.fileName,
          /// 量房原表没保存 mime/尺寸；这里用 png 占位，画布按 naturalWidth/Height 回填渲染
          mimeType: "image/jpeg",
          width: null,
          height: null,
          bytes: null,
          roomLabel: p.roomLabel,
        },
      }),
    ),
  );

  // 如果 session 之前没绑定 record，顺手绑上（便于下一次直接复用）
  if (!session.measurementRecordId && measurementRecordId) {
    await db.visualizerSession.update({
      where: { id: sessionId },
      data: { measurementRecordId, updatedAt: new Date() },
    });
  } else {
    await db.visualizerSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  const images: VisualizerSourceImageSummary[] = created.map((img) => ({
    id: img.id,
    fileUrl: img.fileUrl,
    fileName: img.fileName,
    mimeType: img.mimeType,
    width: img.width,
    height: img.height,
    roomLabel: img.roomLabel,
    createdAt: img.createdAt.toISOString(),
    regionCount: 0,
    regions: [],
  }));

  return NextResponse.json({
    imported: created.length,
    skipped: incomingPhotos.length - created.length,
    images,
  });
});
