import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getChannel, deleteChannel } from "@/lib/trade/channel-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { channel } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "default";
  const ch = await getChannel(orgId, channel);
  if (!ch) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
  return NextResponse.json(ch);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { channel } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "default";
  await deleteChannel(orgId, channel);
  return NextResponse.json({ success: true });
}
