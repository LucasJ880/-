/**
 * 消息网关状态 API
 *
 * GET  /api/messaging/gateway — 获取所有通道状态
 * POST /api/messaging/gateway — 操作通道（启动/停止/配置）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const maxDuration = 30;

export const GET = withAuth(async (_req, _ctx, user) => {
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true, role: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const gateways = await db.weChatGateway.findMany({
    where: { orgId: membership.orgId },
    select: {
      id: true,
      channel: true,
      status: true,
      loginStatus: true,
      botNickname: true,
      corpId: true,
      agentId: true,
      mode: true,
      fulfillmentOrgId: true,
      lastHeartbeat: true,
      errorMessage: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ gateways });
});

export const POST = withAuth(async (req, _ctx, user) => {
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true, role: true },
  });

  // 授权：平台管理员（User.role）或组织管理员（OrganizationMember.role=org_admin）可操作网关。
  // 兼容历史数据里 membership.role 误写为 admin/super_admin 的情况。
  const isPlatformAdmin = user.role === "admin" || user.role === "super_admin";
  const isOrgAdmin =
    !!membership && ["org_admin", "admin", "super_admin"].includes(membership.role);
  if (!membership || (!isPlatformAdmin && !isOrgAdmin)) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const { action, channel } = body;

  if (action === "configure_wecom") {
    const { corpId, agentId, secret, callbackToken, encodingKey } = body;
    if (!corpId || !secret) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    await db.weChatGateway.upsert({
      where: { orgId_channel: { orgId: membership.orgId, channel: "wecom" } },
      create: {
        orgId: membership.orgId,
        channel: "wecom",
        corpId,
        agentId,
        secret,
        callbackToken,
        encodingKey,
        status: "inactive",
      },
      update: { corpId, agentId, secret, callbackToken, encodingKey },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "configure_trade_intake") {
    // 把个人微信网关切换为「外贸客户需求受理」模式，并绑定自动桥接的处理方组织（加拿大团队 org）
    const { fulfillmentOrgId } = body as { fulfillmentOrgId?: string };
    const targetOrgId = (fulfillmentOrgId ?? "").trim() || null;

    if (targetOrgId) {
      if (targetOrgId === membership.orgId) {
        return NextResponse.json(
          { error: "处理方组织不能与客户组织相同" },
          { status: 400 },
        );
      }
      const org = await db.organization.findFirst({
        where: { id: targetOrgId, status: "active" },
        select: { id: true },
      });
      if (!org) {
        return NextResponse.json({ error: "处理方组织不存在或未激活" }, { status: 400 });
      }
    }

    await db.weChatGateway.upsert({
      where: { orgId_channel: { orgId: membership.orgId, channel: "personal_wechat" } },
      create: {
        orgId: membership.orgId,
        channel: "personal_wechat",
        status: "inactive",
        mode: "trade_intake",
        fulfillmentOrgId: targetOrgId,
      },
      update: { mode: "trade_intake", fulfillmentOrgId: targetOrgId },
    });

    return NextResponse.json({ ok: true, mode: "trade_intake", fulfillmentOrgId: targetOrgId });
  }

  if (action === "request_qr") {
    try {
      const { PersonalWeChatAdapter } = await import("@/lib/messaging/adapters/personal-wechat");
      const adapter = new PersonalWeChatAdapter(membership.orgId);
      const { qrUrl, ticket } = await adapter.getLoginQR();

      return NextResponse.json({
        qrUrl,
        ticket,
        status: "qr_pending",
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({
        error: errMsg,
        status: "error",
        hint: "请确认 iLink Bot 服务可用（ilinkai.weixin.qq.com），如使用自建服务请设置 ILINK_API_BASE 环境变量",
      }, { status: 502 });
    }
  }

  if (action === "check_qr_status") {
    const { ticket } = body;
    if (!ticket) {
      return NextResponse.json({ error: "缺少 ticket" }, { status: 400 });
    }
    try {
      const { PersonalWeChatAdapter } = await import("@/lib/messaging/adapters/personal-wechat");
      const { registerAdapter, attachAdapterInbound } = await import("@/lib/messaging/gateway");
      const adapter = new PersonalWeChatAdapter(membership.orgId);
      const result = await adapter.checkQRStatus(ticket);

      if (result.status === "confirmed") {
        // 按网关业务模式（assistant / trade_intake）绑定对应入站处理器
        const gw = await db.weChatGateway.findUnique({
          where: { orgId_channel: { orgId: membership.orgId, channel: "personal_wechat" } },
          select: { mode: true, fulfillmentOrgId: true },
        });
        await attachAdapterInbound(adapter, {
          orgId: membership.orgId,
          mode: gw?.mode,
          fulfillmentOrgId: gw?.fulfillmentOrgId,
        });
        registerAdapter(adapter);
      }

      return NextResponse.json(result);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: errMsg, status: "error" }, { status: 502 });
    }
  }

  if (action === "disconnect") {
    if (!channel) return NextResponse.json({ error: "缺少 channel" }, { status: 400 });

    if (channel === "personal_wechat") {
      const { PersonalWeChatAdapter } = await import("@/lib/messaging/adapters/personal-wechat");
      const adapter = new PersonalWeChatAdapter(membership.orgId);
      await adapter.stop();
    } else {
      await db.weChatGateway.updateMany({
        where: { orgId: membership.orgId, channel },
        data: { status: "inactive", loginStatus: "disconnected" },
      });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
});
