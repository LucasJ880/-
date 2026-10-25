import { NextRequest, NextResponse } from "next/server";
import type { TradeChannel } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit/logger";
import {
  WebsiteChannelError,
  channelView,
  deleteChannel,
  enableWebsiteChannelEmbed,
  endWebsiteChannelSecretGrace,
  getChannel,
  rotateWebsiteChannelPublicKey,
  rotateWebsiteChannelSecret,
  setWebsiteChannelAllowedOrigins,
} from "@/lib/trade/channel-service";
import { canManageTradeChannels, channelManageForbiddenResponse } from "@/lib/trade/channel-access";
import { resolveTradeOrgId } from "@/lib/trade/access";
import {
  MAX_ALLOWED_ORIGINS,
  activePreviousSecrets,
  maskCredential,
  parseAllowedOrigins,
  readWebsiteCredentials,
} from "@/lib/trade/website-channel-credentials";
import { inboundAddressFor, normalizeInboundDomain } from "@/lib/trade/email-inbound-rules";

type Ctx = { params: Promise<{ channel: string }> };

/**
 * 单个通道：外贸角色都拿到掩码视图（凭证只显示末 4 位）；
 * website 通道的服务端密钥 / 公开 key / 来源白名单只给能管理通道的角色（view.website）。
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { channel } = await params;
  const canManage = await canManageTradeChannels(auth.user, orgRes.orgId);
  const ch = await getChannel(orgRes.orgId, channel);
  if (!ch) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
  const view = channelView(ch, canManage);
  if (channel === "email") {
    // 转发地址 = 平台收信域名 + 本企业别名（业务员需要知道往哪转发，所以外贸角色都可见）；域名未配置时不生成地址（页面显示「未开通」）
    const domain = normalizeInboundDomain(process.env.INBOUND_EMAIL_DOMAIN);
    const alias = (ch.config as Record<string, unknown> | null)?.inboundAlias;
    return NextResponse.json({ ...view, inbound: { enabled: !!domain, address: inboundAddressFor(alias, domain) } });
  }
  return NextResponse.json(view);
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;
  if (!(await canManageTradeChannels(auth.user, orgRes.orgId))) return channelManageForbiddenResponse();

  const { channel } = await params;
  const existing = await getChannel(orgRes.orgId, channel);
  if (!existing) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
  await deleteChannel(orgRes.orgId, channel);
  await logAudit({
    userId: auth.user.id,
    orgId: orgRes.orgId,
    action: "trade.channel.delete",
    targetType: "trade_channel",
    targetId: existing.id,
    beforeData: { channel: existing.channel, name: existing.name, status: existing.status },
    request,
  });
  return NextResponse.json({ success: true });
}

/** website 通道管理动作 → 服务层（set_allowed_origins 另需校验输入，单独处理） */
const WEBSITE_ACTIONS = {
  rotate_secret: rotateWebsiteChannelSecret,
  end_secret_grace: endWebsiteChannelSecretGrace,
  enable_embed: enableWebsiteChannelEmbed,
  rotate_public_key: rotateWebsiteChannelPublicKey,
};

/** 审计快照（凭证只记掩码）：每个动作只记它改动的字段；轮换密钥的事后快照另带旧密钥宽限期 */
function auditView(action: string, config: unknown, after: boolean): Record<string, unknown> {
  const c = readWebsiteCredentials(config);
  const previousSecrets = () => activePreviousSecrets(config, new Date()).map((p) => maskCredential(p.secret));
  if (action === "set_allowed_origins") return { allowedOrigins: c.allowedOrigins };
  if (action === "end_secret_grace") return { previousSecrets: previousSecrets() };
  if (action !== "rotate_secret") return { publicKey: c.publicKey && maskCredential(c.publicKey) };
  return { secret: c.secret && maskCredential(c.secret), ...(after ? { secretPrevExpiresAt: c.secretPrevExpiresAt } : {}), previousSecrets: previousSecrets() };
}

/**
 * website 通道管理动作（仅企业负责人 / 管理员 / 平台管理员）：
 * - rotate_secret：轮换服务端密钥，被换下的与此前仍在宽限期内的旧密钥各自 72 小时内仍可用；
 *   宽限期内已有 3 个旧密钥时 409（不挤掉站点可能仍在用的旧密钥）
 * - end_secret_grace：立即停用全部旧密钥（密钥泄露时用）
 * - enable_embed：生成嵌入表单公开 key（已有则不变）
 * - rotate_public_key：轮换公开 key，立即生效
 * - set_allowed_origins：设置嵌入表单来源白名单（精确 scheme + host[:port]）
 * 返回与 GET 相同的视图（含完整凭证）。审计里只记掩码。
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as { orgId?: unknown; action?: unknown; allowedOrigins?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求体须为 JSON" }, { status: 400 });
  }
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!orgRes.ok) return orgRes.response;
  if (!(await canManageTradeChannels(auth.user, orgRes.orgId))) return channelManageForbiddenResponse();

  const { channel } = await params;
  const action = typeof body.action === "string" ? body.action : "";
  if (channel !== "website" || !(Object.hasOwn(WEBSITE_ACTIONS, action) || action === "set_allowed_origins")) {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  const before = await getChannel(orgRes.orgId, "website");
  if (!before) return NextResponse.json({ error: "网站询盘通道不存在，请先添加" }, { status: 404 });

  let ch: TradeChannel;
  try {
    if (action !== "set_allowed_origins") {
      ch = await WEBSITE_ACTIONS[action as keyof typeof WEBSITE_ACTIONS](orgRes.orgId);
    } else {
      const parsed = parseAllowedOrigins(body.allowedOrigins);
      if (parsed.invalid.length) {
        return NextResponse.json(
          { error: `来源格式不正确（只填 https://域名[:端口]，不带路径）：${parsed.invalid.slice(0, 5).join("、")}`, invalid: parsed.invalid },
          { status: 400 },
        );
      }
      if (parsed.origins.length > MAX_ALLOWED_ORIGINS) {
        return NextResponse.json({ error: `最多 ${MAX_ALLOWED_ORIGINS} 个来源` }, { status: 400 });
      }
      ch = await setWebsiteChannelAllowedOrigins(orgRes.orgId, parsed.origins);
    }
    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: `trade.channel.website.${action}`,
      targetType: "trade_channel",
      targetId: before.id,
      beforeData: auditView(action, before.config, false),
      afterData: auditView(action, ch.config, true),
      request,
    });
  } catch (err) {
    if (err instanceof WebsiteChannelError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "NOT_FOUND" ? 404 : 409 });
    }
    throw err;
  }

  return NextResponse.json(channelView(ch, true));
}
