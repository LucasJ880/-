import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listChannels, upsertChannel } from "@/lib/trade/channel-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgId = new URL(request.url).searchParams.get("orgId") ?? "default";
  const channels = await listChannels(orgId);
  return NextResponse.json(channels);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!body.channel || !body.name || !body.config) {
    return NextResponse.json({ error: "channel, name, config 必填" }, { status: 400 });
  }

  const channel = await upsertChannel({
    orgId: body.orgId ?? "default",
    channel: body.channel,
    name: body.name,
    config: body.config,
  });
  return NextResponse.json(channel, { status: 201 });
}
