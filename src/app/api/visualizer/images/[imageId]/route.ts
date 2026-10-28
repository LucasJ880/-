import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  visualizerAccessResponse,
  visualizerSessionAccess,
  loadSessionBySourceImage,
} from "@/lib/visualizer/access";
import { resolveVisualizerOrgId } from "@/lib/visualizer/org-context";

/**
 * DELETE /api/visualizer/images/[imageId]
 * 物理删除：regions 会级联删除；blob 暂不主动清理（留给后续清理任务）
 */
export const DELETE = withAuth(async (request, ctx, user) => {
  const orgRes = await resolveVisualizerOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;
  const { imageId } = await ctx.params;

  const session = await loadSessionBySourceImage(imageId);
  if (!session) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  const denied = visualizerAccessResponse(
    visualizerSessionAccess(session, user, orgRes.orgId),
    "无权删除该图片",
    "图片不存在",
  );
  if (denied) return denied;

  await db.visualizerSourceImage.delete({ where: { id: imageId } });
  await db.visualizerSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
