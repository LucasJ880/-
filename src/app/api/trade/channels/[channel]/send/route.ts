import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { sendChannelMessage } from "@/lib/trade/channel-service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { syncTradeOutboundToRevenueSpine } from "@/lib/trade/outbound-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { channel } = await params;

  if (!body.prospectId || !body.to || !body.content) {
    return NextResponse.json({ error: "prospectId, to, content 必填" }, { status: 400 });
  }

  const p = await loadTradeProspectForOrg(String(body.prospectId), orgRes.orgId);
  if (p instanceof NextResponse) return p;

  try {
    const result = await sendChannelMessage({
      orgId: orgRes.orgId,
      prospectId: body.prospectId,
      channel: channel as "whatsapp" | "wechat" | "wechat_work",
      to: body.to,
      content: body.content,
    });
    // 通道消息也是客户真实收到的回复：镜像到 Revenue Spine 并作废旧邮件草稿（失败只记录）
    const revenueSync = await syncTradeOutboundToRevenueSpine({
      orgId: orgRes.orgId,
      prospectId: String(body.prospectId),
      tradeMessageId: result.message.id,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      source: "trade_channel.send",
      channel,
      content: String(body.content),
      occurredAt: result.message.createdAt,
    });
    return NextResponse.json({ ...result, revenueSync });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "发送失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
