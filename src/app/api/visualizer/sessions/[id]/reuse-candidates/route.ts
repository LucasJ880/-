import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  SESSION_ACCESS_SELECT,
  visualizerAccessResponse,
  visualizerSessionAccess,
  visualizerSessionListScope,
} from "@/lib/visualizer/access";
import { resolveVisualizerOrgId } from "@/lib/visualizer/org-context";

/**
 * GET /api/visualizer/sessions/[id]/reuse-candidates
 *
 * 列出"同客户 + 非当前 + 非 archived"的其他 Visualizer session 里的所有 source images，
 * 用于跨 session 复用照片。
 *
 * 权限：
 * - 目标 session 必须能看到
 * - 源 session 也必须能看到（通过 visualizerSessionListScope 过滤，始终限定当前企业）
 *
 * 响应：
 * {
 *   groups: Array<{
 *     sessionId, title, opportunityTitle, updatedAt,
 *     images: Array<{ id, fileUrl, fileName, mimeType, width, height, roomLabel, createdAt }>
 *   }>
 * }
 */

export const GET = withAuth(async (request, ctx, user) => {
  const { id: sessionId } = await ctx.params;
  const orgRes = await resolveVisualizerOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const target = await db.visualizerSession.findUnique({
    where: { id: sessionId },
    select: { ...SESSION_ACCESS_SELECT, customerId: true },
  });
  if (!target) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  const denied = visualizerAccessResponse(
    visualizerSessionAccess(target, user, orgRes.orgId),
  );
  if (denied) return denied;

  const otherSessions = await db.visualizerSession.findMany({
    where: {
      customerId: target.customerId,
      id: { not: sessionId },
      status: { not: "archived" },
      ...visualizerSessionListScope(user, orgRes.orgId),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      opportunity: { select: { title: true } },
      sourceImages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileUrl: true,
          fileName: true,
          mimeType: true,
          width: true,
          height: true,
          roomLabel: true,
          createdAt: true,
        },
      },
    },
  });

  const groups = otherSessions
    .filter((s) => s.sourceImages.length > 0)
    .map((s) => ({
      sessionId: s.id,
      title: s.title,
      opportunityTitle: s.opportunity?.title ?? null,
      updatedAt: s.updatedAt.toISOString(),
      images: s.sourceImages.map((img) => ({
        id: img.id,
        fileUrl: img.fileUrl,
        fileName: img.fileName,
        mimeType: img.mimeType,
        width: img.width,
        height: img.height,
        roomLabel: img.roomLabel,
        createdAt: img.createdAt.toISOString(),
      })),
    }));

  return NextResponse.json({ groups });
});
