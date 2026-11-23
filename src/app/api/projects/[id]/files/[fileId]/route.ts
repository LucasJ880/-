import { NextResponse } from "next/server";
import { deleteBlob, blobPathnameFromUrl } from "@/lib/files/blob-access";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

/**
 * DELETE /api/projects/:id/files/:fileId
 * 删除项目文件（同时清理 Blob 存储）
 *
 * 需项目读权限（成员/owner/admin），与上传同级。先过权限再查文件：
 * 被拒的响应与文件 ID 是否存在无关，探测不到文件 ID。
 */
export const DELETE = withAuth(async (request, ctx) => {
  const { id: projectId, fileId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const doc = await db.projectDocument.findFirst({
    where: { id: fileId, projectId },
  });

  if (!doc) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  if (doc.blobUrl) {
    try {
      // 兼容历史 blob URL 与新代理 URL：统一按 pathname 删除
      await deleteBlob(blobPathnameFromUrl(doc.blobUrl));
    } catch {
      // Blob 删除失败不阻塞数据库记录删除
    }
  }

  await db.projectDocument.delete({ where: { id: fileId } });

  return NextResponse.json({ success: true });
});
