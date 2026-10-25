import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getChannel, deleteChannel } from "@/lib/trade/channel-service";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { inboundAddressFor, normalizeInboundDomain } from "@/lib/trade/email-inbound-rules";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { channel } = await params;
  const ch = await getChannel(orgRes.orgId, channel);
  if (!ch) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
  if (channel === "email") {
    // 转发地址由平台收信域名 + 本企业别名组成；域名未配置时不生成地址（页面显示「未开通」）
    const domain = normalizeInboundDomain(process.env.INBOUND_EMAIL_DOMAIN);
    const alias = (ch.config as Record<string, unknown> | null)?.inboundAlias;
    return NextResponse.json({ ...ch, inbound: { enabled: !!domain, address: inboundAddressFor(alias, domain) } });
  }
  return NextResponse.json(ch);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { channel } = await params;
  await deleteChannel(orgRes.orgId, channel);
  return NextResponse.json({ success: true });
}
