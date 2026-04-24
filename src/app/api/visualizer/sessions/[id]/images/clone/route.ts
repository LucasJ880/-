import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  SESSION_ACCESS_SELECT,
  canSeeVisualizerSession,
} from "@/lib/visualizer/access";
import type { VisualizerSourceImageSummary } from "@/lib/visualizer/types";

/**
 * POST /api/visualizer/sessions/[id]/images/clone
 *
 * 将同客户下"其他 session 的某些 source images"以引用方式克隆到当前 session。
 * - 只新建 VisualizerSourceImage DB row，不物理复制 blob（fileUrl 复用指向同一对象）
 * - 去重规则：目标 session 已存在相同 fileUrl 的图片会被跳过
 * - 被克隆的 source images 必须属于同一客户，且调用方必须能看到其所属 session
 *
 * Body: { sourceImageIds: string[] }
 * Returns: { imported: number; skipped: number; images: VisualizerSourceImageSummary[] }
 */

interface CloneBody {
  sourceImageIds?: string[];
}

export const POST = withAuth(async (request, ctx, user) => {
  const { id: sessionId } = await ctx.params;

  const target = await db.visualizerSession.findUnique({
    where: { id: sessionId },
    select: { ...SESSION_ACCESS_SELECT, customerId: true },
  });
  if (!target) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(target, user)) {
    return NextResponse.json({ error: "无权操作该可视化方案" }, { status: 403 });
  }

  const body = await safeParseBody<CloneBody>(request);
  const ids = Array.isArray(body?.sourceImageIds)
    ? body.sourceImageIds.map((x) => String(x)).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "sourceImageIds 必填且非空" },
      { status: 400 },
    );
  }

  // 拉出所有候选源图 + 其 session（用于权限 + 同客户校验）
  const candidates = await db.visualizerSourceImage.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      width: true,
      height: true,
      roomLabel: true,
      measurementPhotoId: true,
      sessionId: true,
      session: { select: SESSION_ACCESS_SELECT },
    },
  });

  // 过滤掉：找不到 / 跨客户 / 无权看源 session / 源 session 就是自己
  const visible = candidates.filter((c) => {
    if (!c.session) return false;
    if (c.sessionId === sessionId) return false;
    if (c.session.customerId !== target.customerId) return false;
    if (!canSeeVisualizerSession(c.session, user)) return false;
    return true;
  });

  if (visible.length === 0) {
    return NextResponse.json(
      { error: "没有可复用的源图（不存在、跨客户或无权访问）" },
      { status: 400 },
    );
  }

  // 去重：目标 session 已存在的 fileUrl 不重复写
  const existing = await db.visualizerSourceImage.findMany({
    where: {
      sessionId,
      fileUrl: { in: visible.map((v) => v.fileUrl) },
    },
    select: { fileUrl: true },
  });
  const existingSet = new Set(existing.map((e) => e.fileUrl));
  const toCreate = visible.filter((v) => !existingSet.has(v.fileUrl));

  const created = await Promise.all(
    toCreate.map((v) =>
      db.visualizerSourceImage.create({
        data: {
          sessionId,
          fileUrl: v.fileUrl,
          fileName: v.fileName,
          mimeType: v.mimeType,
          width: v.width,
          height: v.height,
          bytes: null,
          roomLabel: v.roomLabel,
          // 弱引用原量房照片（如有），便于未来数据溯源
          measurementPhotoId: v.measurementPhotoId,
        },
      }),
    ),
  );

  await db.visualizerSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

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
    skipped: visible.length - created.length,
    notFound: ids.length - candidates.length,
    images,
  });
});
