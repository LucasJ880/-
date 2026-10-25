import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit/logger";
import {
  getChannelView,
  listChannels,
  toChannelView,
  upsertChannel,
  upsertEmailChannel,
  upsertWebsiteChannel,
} from "@/lib/trade/channel-service";
import { CAN_MANAGE_CHANNELS_HEADER, canManageTradeChannels, channelManageForbiddenResponse } from "@/lib/trade/channel-access";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { normalizeForwarderAllowlist } from "@/lib/trade/email-inbound-rules";

const CHANNEL_TYPES = new Set(["whatsapp", "wechat", "wechat_work", "website", "email"]);

/** 列表：外贸角色都可读，凭证一律只显示末 4 位；能否管理放在响应头里（列表保持数组，兼容既有调用方） */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const [channels, canManage] = await Promise.all([listChannels(orgRes.orgId), canManageTradeChannels(auth.user, orgRes.orgId)]);
  return NextResponse.json(channels, { headers: { [CAN_MANAGE_CHANNELS_HEADER]: canManage ? "1" : "0" } });
}

/** 新建 / 更新通道：仅企业负责人 / 企业管理员 / 平台管理员 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体须为 JSON" }, { status: 400 });
  }
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;
  if (!(await canManageTradeChannels(auth.user, orgRes.orgId))) return channelManageForbiddenResponse();

  if (!body.channel || !body.name || !body.config) {
    return NextResponse.json({ error: "channel, name, config 必填" }, { status: 400 });
  }
  if (!CHANNEL_TYPES.has(String(body.channel))) {
    return NextResponse.json({ error: "不支持的通道类型" }, { status: 400 });
  }

  // 邮件转发询盘通道：别名由服务端生成且不可指定；请求只能改显示名与转发白名单
  if (body.channel === "email") {
    const allow = normalizeForwarderAllowlist(body.config?.forwarderAllowlist);
    if (!allow.ok) {
      return NextResponse.json({ error: allow.error, invalid: allow.invalid }, { status: 400 });
    }
    const ch = await upsertEmailChannel({
      orgId: orgRes.orgId,
      name: String(body.name).trim().slice(0, 60),
      forwarderAllowlist: allow.value,
    });
    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: "trade.channel.email.upsert",
      targetType: "trade_channel",
      targetId: ch.id,
      afterData: { name: ch.name, status: ch.status, forwarders: allow.value.length },
      request,
    });
    return NextResponse.json(toChannelView(ch), { status: 201 });
  }

  // 网站询盘通道：凭证由服务端生成；重复保存沿用已有凭证与来源白名单，避免网页代码失效
  if (body.channel === "website") {
    const ch = await upsertWebsiteChannel({ orgId: orgRes.orgId, name: String(body.name) });
    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: "trade.channel.website.upsert",
      targetType: "trade_channel",
      targetId: ch.id,
      afterData: { name: ch.name, status: ch.status },
      request,
    });
    return NextResponse.json(await getChannelView(orgRes.orgId, "website", { canManage: true }), { status: 201 });
  }

  const ch = await upsertChannel({
    orgId: orgRes.orgId,
    channel: body.channel,
    name: body.name,
    config: body.config,
  });
  // 响应只回掩码视图：凭证写入后不再原样出服务端
  return NextResponse.json(toChannelView(ch), { status: 201 });
}
