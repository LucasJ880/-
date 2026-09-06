/**
 * POST /api/trade/prospects/[id]/messages
 * 手工记一条消息到线索时间线（收件箱「已回复，标记」、系统外沟通留痕）。
 * body: { orgId?, direction: "inbound" | "outbound", channel?, subject?, content }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createMessage, updateProspect } from "@/lib/trade/service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

const CHANNELS = new Set(["email", "whatsapp", "wechat", "wechat_work", "website", "phone", "other"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const content = typeof body.content === "string" ? body.content.trim().slice(0, 4000) : "";
  if (!content) {
    return NextResponse.json({ error: "content 必填" }, { status: 400 });
  }
  const direction = body.direction === "inbound" ? "inbound" : "outbound";
  const channelRaw = typeof body.channel === "string" ? body.channel.trim().toLowerCase() : "";
  const channel = CHANNELS.has(channelRaw) ? channelRaw : "other";
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : undefined;

  const message = await createMessage({
    prospectId: id,
    direction,
    channel,
    subject,
    content,
  });

  if (direction === "outbound") {
    await updateProspect(id, { lastContactAt: new Date() });
  } else {
    const { scheduleInquiryAnalysis } = await import("@/lib/trade/inquiry-analysis");
    await scheduleInquiryAnalysis({
      orgId: orgRes.orgId,
      prospectId: id,
      messageId: message.id,
      content: content,
      channel,
      meta: {
        email: loaded.prospect.contactEmail,
        companyName: loaded.prospect.companyName,
        country: loaded.prospect.country,
        website: loaded.prospect.website,
      },
    });
  }

  return NextResponse.json({ message }, { status: 201 });
}
