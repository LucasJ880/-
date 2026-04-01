import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

/**
 * DELETE /api/projects/:id/files/:fileId
 * 删除项目文件（同时清理 Blob 存储）
 */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: projectId, fileId } = await ctx.params;

  const doc = await db.projectDocument.findFirst({
    where: { id: fileId, projectId },
  });

  if (!doc) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  // 如果是上传的文件，从 Blob 存储中删除
  if (doc.blobUrl) {
    try {
      await del(doc.blobUrl);
    } catch {
      // Blob 删除失败不阻塞数据库记录删除
    }
  }

  await db.projectDocument.delete({ where: { id: fileId } });

  return NextResponse.json({ success: true });
}
