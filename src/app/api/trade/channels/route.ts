import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireRole } from "@/lib/auth/guards";
import { listChannels, upsertChannel, getChannel } from "@/lib/trade/channel-service";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const channels = await listChannels(orgRes.orgId);
  return NextResponse.json(channels);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body.channel || !body.name || !body.config) {
    return NextResponse.json({ error: "channel, name, config 必填" }, { status: 400 });
  }

  let config: Record<string, string> = body.config;
  if (body.channel === "website") {
    // 网站询盘通道：密钥由服务端生成；重复保存沿用旧密钥，避免网页代码失效
    const existing = await getChannel(orgRes.orgId, "website");
    const prevSecret = (existing?.config as Record<string, string> | null)?.secret;
    config = {
      ...body.config,
      secret: prevSecret || randomBytes(18).toString("base64url"),
    };
  }

  const channel = await upsertChannel({
    orgId: orgRes.orgId,
    channel: body.channel,
    name: body.name,
    config,
  });
  return NextResponse.json(channel, { status: 201 });
}
