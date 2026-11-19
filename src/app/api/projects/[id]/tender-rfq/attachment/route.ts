/**
 * GET /api/projects/[id]/tender-rfq/attachment?actionId=…（CHAIN-4a）
 *
 * 发询价审批卡上「预览」询价单 PDF：按载荷与执行器同样的方式重新排出内容、核对内容指纹，一致才生成 PDF 返回。
 * 只给能读这个项目的人（与项目页询价区给同一批人看每封邮件正文一致——附件内容是正文的子集）；
 * 卡不是本组织本项目的发询价卡、卡上没有附件，一律 404，不区分原因。
 * 只读：不改审批卡、询价轮次与询价项，不发邮件。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { readPayloadAttachment } from "@/lib/tender-rfq/attachment";
import { rebuildFailureForCard, rebuildRfqAttachment, renderRfqAttachmentPdf } from "@/lib/tender-rfq/attachment-service";
import { TENDER_SEND_RFQ_TYPE, type TenderSendRfqPayload } from "@/lib/tender-rfq/types";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND_MESSAGE = "没有找到这份询价附件";
const notFound = () => NextResponse.json({ ok: false, error: NOT_FOUND_MESSAGE }, { status: 404 });

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? access : notFound();
  const orgId = access.project.orgId;
  const actionId = request.nextUrl.searchParams.get("actionId")?.trim() ?? "";
  if (!orgId || !actionId) return notFound();

  const card = await db.pendingAction.findFirst({
    where: { id: actionId, orgId, projectId, type: TENDER_SEND_RFQ_TYPE },
    select: { id: true, payload: true },
  });
  const payload = card?.payload as unknown as TenderSendRfqPayload | null;
  const attachment = readPayloadAttachment(payload);
  if (!card || !payload || payload.projectId !== projectId || !attachment) return notFound();

  const rebuilt = await rebuildRfqAttachment(payload, attachment);
  if (!rebuilt.ok) {
    const f = rebuildFailureForCard(rebuilt);
    return NextResponse.json({ ok: false, stale: f.stale, error: f.message }, { status: 409 });
  }
  const rendered = await renderRfqAttachmentPdf(rebuilt.html);
  if (!rendered.ok) return NextResponse.json({ ok: false, error: "询价附件（PDF）暂时生成不了，请稍后再试" }, { status: 503 });

  const ascii = attachment.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new NextResponse(new Uint8Array(rendered.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
