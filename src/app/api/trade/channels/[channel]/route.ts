import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit/logger";
import {
  WebsiteChannelError,
  deleteChannel,
  enableWebsiteChannelEmbed,
  endWebsiteChannelSecretGrace,
  getChannel,
  getChannelView,
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
  const view = await getChannelView(orgRes.orgId, channel, { canManage });
  if (!view) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
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

const WEBSITE_ACTIONS = new Set(["rotate_secret", "end_secret_grace", "enable_embed", "rotate_public_key", "set_allowed_origins"]);

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
  if (channel !== "website" || !WEBSITE_ACTIONS.has(action)) {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  const before = await getChannel(orgRes.orgId, "website");
  if (!before) return NextResponse.json({ error: "网站询盘通道不存在，请先添加" }, { status: 404 });
  const beforeCred = readWebsiteCredentials(before.config);
  const prevHints = (config: unknown) => activePreviousSecrets(config, new Date()).map((p) => maskCredential(p.secret));

  try {
    let afterData: Record<string, unknown>;
    if (action === "rotate_secret") {
      const ch = await rotateWebsiteChannelSecret(orgRes.orgId);
      const c = readWebsiteCredentials(ch.config);
      afterData = { secret: c.secret ? maskCredential(c.secret) : null, secretPrevExpiresAt: c.secretPrevExpiresAt, previousSecrets: prevHints(ch.config) };
    } else if (action === "end_secret_grace") {
      const ch = await endWebsiteChannelSecretGrace(orgRes.orgId);
      afterData = { previousSecrets: prevHints(ch.config) };
    } else if (action === "enable_embed" || action === "rotate_public_key") {
      const ch = action === "enable_embed" ? await enableWebsiteChannelEmbed(orgRes.orgId) : await rotateWebsiteChannelPublicKey(orgRes.orgId);
      const c = readWebsiteCredentials(ch.config);
      afterData = { publicKey: c.publicKey ? maskCredential(c.publicKey) : null };
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
      await setWebsiteChannelAllowedOrigins(orgRes.orgId, parsed.origins);
      afterData = { allowedOrigins: parsed.origins };
    }
    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: `trade.channel.website.${action}`,
      targetType: "trade_channel",
      targetId: before.id,
      beforeData:
        action === "set_allowed_origins"
          ? { allowedOrigins: beforeCred.allowedOrigins }
          : action === "rotate_secret"
            ? { secret: beforeCred.secret ? maskCredential(beforeCred.secret) : null, previousSecrets: prevHints(before.config) }
            : action === "end_secret_grace"
              ? { previousSecrets: prevHints(before.config) }
              : { publicKey: beforeCred.publicKey ? maskCredential(beforeCred.publicKey) : null },
      afterData,
      request,
    });
  } catch (err) {
    if (err instanceof WebsiteChannelError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "NOT_FOUND" ? 404 : 409 });
    }
    throw err;
  }

  const view = await getChannelView(orgRes.orgId, "website", { canManage: true });
  return NextResponse.json(view);
}
