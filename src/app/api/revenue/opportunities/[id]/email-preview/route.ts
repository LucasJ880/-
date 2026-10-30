/**
 * GET /api/revenue/opportunities/[id]/email-preview?pendingActionId=… — 草稿邮件的 HTML 版（起草时渲染、批准后原样发出）
 * 页面放进 sandbox iframe 显示（不执行脚本）；只读，不改任何状态。
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { REVENUE_READ_KEYS, resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const access = await resolveRevenueAccess(request, REVENUE_READ_KEYS);
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const paId = request.nextUrl.searchParams.get("pendingActionId") ?? "";
  if (!paId) return NextResponse.json({ error: "缺少 pendingActionId" }, { status: 400 });
  const pa = await db.pendingAction.findFirst({
    where: { id: paId, orgId: access.orgId, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: id } },
    select: { payload: true },
  });
  if (!pa) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
  const p = (pa.payload ?? {}) as { subject?: unknown; html?: unknown };
  return NextResponse.json({
    subject: typeof p.subject === "string" ? p.subject : "",
    html: typeof p.html === "string" ? p.html : null,
  });
}
