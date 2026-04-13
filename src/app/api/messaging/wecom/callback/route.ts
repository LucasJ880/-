/**
 * 企业微信回调接收 API
 *
 * GET  — URL 验证
 * POST — 接收消息推送
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleInboundMessage } from "@/lib/messaging/gateway";
import type { InboundMessage } from "@/lib/messaging/types";

/**
 * 企业微信回调 URL 验证
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const msgSignature = searchParams.get("msg_signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";
  const echostr = searchParams.get("echostr") ?? "";
  const orgId = searchParams.get("org") ?? "";

  if (!orgId) {
    return new NextResponse("missing org param", { status: 400 });
  }

  const gateway = await db.weChatGateway.findUnique({
    where: { orgId_channel: { orgId, channel: "wecom" } },
  });

  if (!gateway?.callbackToken || !gateway?.encodingKey) {
    return new NextResponse("not configured", { status: 404 });
  }

  const { WeComAdapter } = await import("@/lib/messaging/adapters/wecom");
  const adapter = new WeComAdapter(orgId);
  await adapter.start();
  const plain = adapter.verifyCallback(msgSignature, timestamp, nonce, echostr);

  if (plain === null) {
    return new NextResponse("signature mismatch", { status: 403 });
  }

  return new NextResponse(plain, { status: 200 });
}

/**
 * 接收企业微信消息推送
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("org") ?? "";

  if (!orgId) {
    return NextResponse.json({ errcode: 0, errmsg: "ok" });
  }

  try {
    const body = await req.text();

    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId, channel: "wecom" } },
    });
    if (!gateway?.encodingKey) {
      return NextResponse.json({ errcode: 0, errmsg: "ok" });
    }

    // 解析 XML（简化的 XML 解析，提取关键字段）
    const parsed = parseWeComXML(body);

    if (!parsed.FromUserName || !parsed.Content) {
      return NextResponse.json({ errcode: 0, errmsg: "ok" });
    }

    const msg: InboundMessage = {
      channel: "wecom",
      externalUserId: parsed.FromUserName,
      content: parsed.Content,
      messageType: "text",
      externalMsgId: parsed.MsgId,
      timestamp: new Date(parseInt(parsed.CreateTime || "0") * 1000),
    };

    // 异步处理，立即返回（企业微信要求 5 秒内响应）
    handleInboundMessage(msg).catch((e) =>
      console.error("[WeCom Callback] Handle error:", e),
    );

    return NextResponse.json({ errcode: 0, errmsg: "ok" });
  } catch (e) {
    console.error("[WeCom Callback] Error:", e);
    return NextResponse.json({ errcode: 0, errmsg: "ok" });
  }
}

function parseWeComXML(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagRegex = /<(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}
