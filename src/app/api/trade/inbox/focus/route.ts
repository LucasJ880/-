/**
 * GET /api/trade/inbox/focus?orgId=&prospectId=|opportunityId=
 * 询盘收件箱：单个买家的会话与最后一封来信全文（NAV-1c；spec trade/inquiry-reply-entry）。
 * 给回复窗口与深链用：不受列表的筛选、时间窗口与条数上限影响；只读，不发信、不调模型。
 * 线索不存在 / 不属于本企业 / 商机没有对应线索，统一 404 THREAD_NOT_FOUND，不区分原因。
 */

import { NextRequest, NextResponse } from "next/server";
import { holdsTradePermission, resolveTradeOrgId, TRADE_MANAGE_KEYS, TRADE_READ_KEYS, requireTradePermission } from "@/lib/trade/access";
import { loadInquiryThreadFocus } from "@/lib/trade/inbox-service";
import { loadApprovalDraft } from "@/lib/trade/reply-target-server";

export async function GET(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_READ_KEYS);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const prospectId = url.searchParams.get("prospectId")?.trim() || null;
  const opportunityId = url.searchParams.get("opportunityId")?.trim() || null;
  // NAV-3：从待批草稿卡进来时带的草稿 id（可选）
  const approvalId = url.searchParams.get("approvalId")?.trim() || null;
  if (!prospectId && !opportunityId) {
    return NextResponse.json({ error: "缺少 prospectId 或 opportunityId", code: "TARGET_REQUIRED" }, { status: 400 });
  }

  const focus = await loadInquiryThreadFocus(orgRes.orgId, { prospectId, opportunityId });
  if (!focus) {
    return NextResponse.json({ error: "没有找到这位买家的询盘会话", code: "THREAD_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({
    thread: focus.thread,
    lastInbound: focus.lastInbound,
    // NAV-3：只在请求带 approvalId 时出现；草稿不可用为 null，不区分原因
    ...(approvalId ? { approvalDraft: await loadApprovalDraft(orgRes.orgId, focus.thread.prospectId, approvalId) } : {}),
    capabilities: {
      emailSend: Boolean(process.env.RESEND_API_KEY),
      // NAV-6：同列表接口——当前成员能不能回复
      reply: await holdsTradePermission(auth.user, orgRes.orgId, TRADE_MANAGE_KEYS),
    },
  });
}
