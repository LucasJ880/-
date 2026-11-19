/**
 * GET /api/projects/[id]/tender-rfq/attachment?actionId=…（CHAIN-4a）
 *
 * 发询价审批卡上「预览 PDF」：按载荷与执行器同样的方式重新排出内容、核对内容指纹，一致才生成询价单 PDF 返回。
 * 只给能读这个项目的人（与项目页询价区给同一批人看每封邮件正文一致——附件内容是正文的子集）；
 * 卡不是本组织本项目的发询价卡、卡上没有附件，一律 404，不区分原因。
 * 这个地址在新标签页里打开，所以出错时回一页中文说明（不是 JSON）。
 * 只读：不改审批卡、询价轮次与询价项，不发邮件。每人每分钟最多 6 次（每次都要启动一次 Chromium）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { readPayloadAttachment } from "@/lib/tender-rfq/attachment";
import { rebuildFailureForCard, rebuildRfqAttachment, renderRfqAttachmentPdf } from "@/lib/tender-rfq/attachment-service";
import { TENDER_SEND_RFQ_TYPE, type TenderSendRfqPayload } from "@/lib/tender-rfq/types";

type Params = { params: Promise<{ id: string }> };

export const RFQ_ATTACHMENT_PREVIEW_MESSAGES = {
  notLoggedIn: "请先登录青砚，再打开这份询价单 PDF。",
  notFound: "没有找到这份询价单 PDF。",
  decided: "这张卡已经处理过（已发出、已驳回或已过期），不再提供询价单 PDF 预览。",
  unavailable: "询价单 PDF 暂时生成不了，请稍后再试。",
  tooMany: "打开得太频繁了，请一分钟后再试。",
} as const;

const PREVIEW_RATE_LIMIT = { name: "tender-rfq-attachment-preview", windowMs: 60_000, maxRequests: 6 };

/** 新标签页里看到的说明页（文字都是常量，转义后放进去） */
function messagePage(status: number, message: string): NextResponse {
  const esc = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>询价单 PDF</title></head><body style="font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1f2328;line-height:1.6"><p>${esc}</p></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: NextRequest, { params }: Params) {
  const M = RFQ_ATTACHMENT_PREVIEW_MESSAGES;
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? messagePage(401, M.notLoggedIn) : messagePage(404, M.notFound);
  const orgId = access.project.orgId;
  const actionId = request.nextUrl.searchParams.get("actionId")?.trim() ?? "";
  if (!orgId || !actionId) return messagePage(404, M.notFound);

  const card = await db.pendingAction.findFirst({
    where: { id: actionId, orgId, projectId, type: TENDER_SEND_RFQ_TYPE },
    select: { id: true, payload: true, status: true },
  });
  const payload = card?.payload as unknown as TenderSendRfqPayload | null;
  const attachment = readPayloadAttachment(payload);
  if (!card || !payload || payload.projectId !== projectId || !attachment) return messagePage(404, M.notFound);
  // 只预览还没处理完的卡（待批 / 已批准正在发出）；发出后重新生成的未必是当时发出的那份
  if (card.status !== "pending" && card.status !== "approved") return messagePage(410, M.decided);

  const rl = await checkRateLimitAsync(PREVIEW_RATE_LIMIT, access.user.id);
  if (!rl.allowed) return messagePage(429, M.tooMany);

  try {
    const rebuilt = await rebuildRfqAttachment(payload, attachment);
    if (!rebuilt.ok) return messagePage(409, rebuildFailureForCard(rebuilt).message);
    const rendered = await renderRfqAttachmentPdf(rebuilt.html);
    if (!rendered.ok) return messagePage(503, M.unavailable);
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
  } catch (err) {
    console.warn("[tender-rfq] attachment preview failed:", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
    return messagePage(503, M.unavailable);
  }
}
