import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listChannels, upsertChannel, upsertEmailChannel, upsertWebsiteChannel } from "@/lib/trade/channel-service";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { normalizeForwarderAllowlist } from "@/lib/trade/email-inbound-rules";

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

  // 邮件转发询盘通道：别名由服务端生成且不可指定；请求只能改显示名与转发白名单
  if (body.channel === "email") {
    const allow = normalizeForwarderAllowlist(body.config?.forwarderAllowlist);
    if (!allow.ok) {
      return NextResponse.json({ error: allow.error, invalid: allow.invalid }, { status: 400 });
    }
    const channel = await upsertEmailChannel({
      orgId: orgRes.orgId,
      name: String(body.name).trim().slice(0, 60),
      forwarderAllowlist: allow.value,
    });
    return NextResponse.json(channel, { status: 201 });
  }

  // 网站询盘通道：密钥由服务端生成；重复保存沿用旧密钥，避免网页代码失效
  const channel =
    body.channel === "website"
      ? await upsertWebsiteChannel({ orgId: orgRes.orgId, name: body.name, config: body.config })
      : await upsertChannel({
          orgId: orgRes.orgId,
          channel: body.channel,
          name: body.name,
          config: body.config,
        });
  return NextResponse.json(channel, { status: 201 });
}
