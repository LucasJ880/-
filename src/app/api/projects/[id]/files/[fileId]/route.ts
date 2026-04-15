import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
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
      await del(doc.blobUrl);
    } catch {
      // Blob 删除失败不阻塞数据库记录删除
    }
  }

  await db.projectDocument.delete({ where: { id: fileId } });

  return NextResponse.json({ success: true });
});
