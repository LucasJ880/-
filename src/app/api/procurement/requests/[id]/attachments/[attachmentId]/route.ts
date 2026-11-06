/** GET /api/procurement/requests/{id}/attachments/{attachmentId}（org_viewer+）：鉴权后流式下载（attachment 方式，不提供公开链接） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { readBlobStream } from "@/lib/files/blob-access";
import { requireRequestAccess, schemaGate } from "@/lib/procurement-records/access";

export const GET = withAuth<{ id: string; attachmentId: string }>(async (_request, ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const { id, attachmentId } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_viewer");
  if (a instanceof NextResponse) return a;
  const att = await db.recordsAttachment.findFirst({ where: { id: attachmentId, requestId: id, orgId: a.orgId } });
  if (!att) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  const blob = await readBlobStream(att.storagePathname);
  if (!blob) return NextResponse.json({ error: "存储读取失败" }, { status: 502 });
  const ascii = att.originalFilename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(blob.stream, {
    headers: {
      "content-type": att.mimeType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.originalFilename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
