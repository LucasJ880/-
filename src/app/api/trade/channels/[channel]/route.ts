import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getChannel, deleteChannel } from "@/lib/trade/channel-service";
import { resolveTradeOrgId } from "@/lib/trade/access";

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
