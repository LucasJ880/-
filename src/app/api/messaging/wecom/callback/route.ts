/**
 * 企业微信回调接收 API
 *
 * GET  — URL 验证（回显解密后的 echostr）
 * POST — 接收消息推送（验签 + 解密 + 按网关业务模式路由）
 *
 * 安全：org 由 query 显式传入，凭证与验签全部服务端校验；
 *       trade_intake 模式下走外贸受理链路（建单到客户 org，可自动桥接处理方 org）。
 */

import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  handleInboundMessage,
  attachAdapterInbound,
} from "@/lib/messaging/gateway";
import { WeComAdapter, parseWeComMessageXml } from "@/lib/messaging/adapters/wecom";
import type { InboundMessage } from "@/lib/messaging/types";

export const maxDuration = 60;

// 注意：每次都要新建 Response（Response body 是一次性流，复用会在第二个请求返回空体）。
function ok(): NextResponse {
  return NextResponse.json({ errcode: 0, errmsg: "ok" });
}

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

  const adapter = new WeComAdapter(orgId);
  await adapter.loadConfig();
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
  const msgSignature = searchParams.get("msg_signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";

  // 任何情况下都尽量回 ok，避免企业微信重试风暴（幂等由受理层兜底）。
  if (!orgId) return ok();

  try {
    const body = await req.text();

    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId, channel: "wecom" } },
    });
    if (!gateway?.encodingKey || !gateway?.callbackToken) return ok();

    const adapter = new WeComAdapter(orgId);
    const loaded = await adapter.loadConfig();
    if (!loaded) return ok();

    // 验签 + 解密内层消息 XML
    const plainXml = adapter.decryptCallback(body, msgSignature, timestamp, nonce);
    if (!plainXml) {
      console.warn("[WeCom Callback] signature/decrypt failed for org", orgId);
      return ok();
    }

    const parsed = parseWeComMessageXml(plainXml);
    const msgType = parsed.MsgType;
    const fromUser = parsed.FromUserName;
    if (!fromUser) return ok();

    // 仅处理文本 / 图片；事件、语音、文件等暂忽略（回 ok）。
    let inbound: InboundMessage | null = null;

    if (msgType === "text" && parsed.Content) {
      inbound = {
        channel: "wecom",
        externalUserId: fromUser,
        content: parsed.Content,
        messageType: "text",
        externalMsgId: parsed.MsgId,
        timestamp: new Date(parseInt(parsed.CreateTime || "0", 10) * 1000 || Date.now()),
        orgId,
      };
    } else if (msgType === "image" && parsed.MediaId) {
      const media = await adapter.downloadMedia(parsed.MediaId);
      if (!media) {
        console.warn("[WeCom Callback] media download failed", parsed.MediaId);
        return ok();
      }
      inbound = {
        channel: "wecom",
        externalUserId: fromUser,
        content: "",
        messageType: "image",
        externalMsgId: parsed.MsgId,
        timestamp: new Date(parseInt(parsed.CreateTime || "0", 10) * 1000 || Date.now()),
        media: { bytes: media.bytes, mimeType: media.mimeType },
        orgId,
      };
    }

    if (!inbound) return ok();

    // 快速回 ok，后台处理（ACK + AI），避免企微等待整段模型调用超时重试。
    // trade_intake 仍需同步处理以保证受理时序；assistant 走 after。
    if (gateway.mode === "trade_intake") {
      await attachAdapterInbound(adapter, {
        orgId,
        mode: gateway.mode,
        fulfillmentOrgId: gateway.fulfillmentOrgId,
      });
      const handler = adapter.getMessageHandler();
      if (handler) await handler(inbound);
      return ok();
    }

    after(async () => {
      try {
        await handleInboundMessage(inbound);
      } catch (e) {
        console.error("[WeCom Callback] async handle failed:", e);
      }
    });

    return ok();
  } catch (e) {
    console.error("[WeCom Callback] Error:", e);
    return ok();
  }
}

