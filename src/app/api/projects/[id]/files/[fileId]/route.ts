import { NextResponse } from "next/server";
import { deleteBlob, blobPathnameFromUrl } from "@/lib/files/blob-access";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

/**
 * DELETE /api/projects/:id/files/:fileId
 * 删除项目文件（同时清理 Blob 存储）
 */
export const DELETE = withAuth(async (_request, ctx) => {
  const { id: projectId, fileId } = await ctx.params;

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
