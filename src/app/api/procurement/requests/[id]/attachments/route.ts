/**
 * /api/procurement/requests/{id}/attachments
 *   POST multipart（file, kind, acquiredAt?）（org_member+）：私有存储、sha256 去重；解析在响应后执行，cron 兜底
 */
import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { isAttachmentKind, MAX_ATTACHMENT_BYTES, processAttachment, saveAttachment } from "@/lib/procurement-records/attachments";

export const maxDuration = 300;

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "缺少文件", code: "FILE_REQUIRED" }, { status: 400 });
  if (!isAttachmentKind(kind)) return NextResponse.json({ error: "附件类别无效", code: "INVALID_KIND" }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: "文件超过 25 MB", code: "FILE_TOO_LARGE" }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const r = await saveAttachment({ requestId: id, userId: user.id, kind, filename: file.name, buffer, acquiredAt: typeof form?.get("acquiredAt") === "string" ? String(form?.get("acquiredAt")) : null });
  if (!r.ok) return serviceResponse(r);
  if (!r.duplicate && r.parseStatus === "PENDING") {
    after(async () => {
      try {
        await processAttachment(r.attachmentId);
      } catch (e) {
        console.error("[procurement-records] parse failed", r.attachmentId, e instanceof Error ? e.message : "unknown");
      }
    });
  }
  return NextResponse.json({ ok: true, attachmentId: r.attachmentId, duplicate: r.duplicate, parseStatus: r.parseStatus }, { status: r.duplicate ? 200 : 201 });
});
