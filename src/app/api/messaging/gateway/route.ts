/**
 * 消息网关状态 API
 *
 * GET  /api/messaging/gateway — 获取所有通道状态
 * POST /api/messaging/gateway — 操作通道（启动/停止/配置）
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
      lastHeartbeat: true,
      errorMessage: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ gateways });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true, role: true },
  });

  if (!membership || !["admin", "super_admin"].includes(membership.role)) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const body = await req.json();
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
        hint: "请检查 ILINK_API_BASE 和 ILINK_API_KEY 环境变量是否已配置",
      }, { status: 502 });
    }
  }

  if (action === "disconnect") {
    if (!channel) return NextResponse.json({ error: "缺少 channel" }, { status: 400 });

    await db.weChatGateway.updateMany({
      where: { orgId: membership.orgId, channel },
      data: { status: "inactive", loginStatus: "disconnected" },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
}
