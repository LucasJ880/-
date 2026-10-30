import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionBySourceImage,
  resolveVisualizerViewer,
} from "@/lib/visualizer/access";

/**
 * DELETE /api/visualizer/images/[imageId]
 * 物理删除：regions 会级联删除；blob 暂不主动清理（留给后续清理任务）
 */
export const DELETE = withAuth(async (_request, ctx, user) => {
  // PERM-4c5：按企业 + 岗位派生角色判定视觉方案"看全部"范围（修复跨企业泄露）
  const viewer = await resolveVisualizerViewer(user);
  const { imageId } = await ctx.params;

  const session = await loadSessionBySourceImage(imageId);
  if (!session) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, viewer)) {
    return NextResponse.json({ error: "无权删除该图片" }, { status: 403 });
  }

  await db.visualizerSourceImage.delete({ where: { id: imageId } });
  await db.visualizerSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
