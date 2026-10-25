/**
 * WeChat Official Account / WeCom Webhook（WECHAT_TOKEN；未配置 403）
 * GET  — 微信服务器验证（明文：signature + timestamp + nonce）
 * POST — 明文验签（缺参数 401，错 403）；加密模式（msg_signature / encrypt_type=aes）501 未实现；ToUserName 解析不到组织 403。
 *        按 MsgId（无则 FromUserName:CreateTime）认领收据后才写消息，平台重发直接回 success（过期见 WECHAT_RECEIPT_STALE_MS）。
 * 只走 Trade 通道：公众号来信只有 openid，进不了 Revenue Spine 的客户去重，故不建客户 / 商机。
 */

import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/trade/channel-service";
import crypto from "crypto";
import { logInboundOrgDenial, resolveInboundTradeOrgId } from "@/lib/trade/inbound-org";
import {
  WECHAT_INBOUND_SOURCE,
  WECHAT_RECEIPT_STALE_MS,
  claimChannelEventReceipt,
  linkReceipt,
  releaseReceipt,
} from "@/lib/trade/website-inquiry-receipts";

const TOKEN = process.env.WECHAT_TOKEN;

function wechatPlainSignatureOk(signature: string, timestamp: string, nonce: string): boolean {
  if (!TOKEN) return false;
  const arr = [TOKEN, timestamp, nonce].sort();
  const hash = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return hash === signature;
}

export async function GET(request: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";
  const echostr = searchParams.get("echostr") ?? "";

  if (wechatPlainSignatureOk(signature, timestamp, nonce)) {
    return new NextResponse(echostr, { status: 200 });
  }
  return NextResponse.json({ error: "验证失败" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const msgSignature = searchParams.get("msg_signature");
  const encryptType = searchParams.get("encrypt_type");

  if (msgSignature || encryptType === "aes") {
    return NextResponse.json(
      {
        error: "msg_signature / encrypted mode detected but encrypted mode is not implemented",
        code: "wechat_encrypt_todo",
      },
      { status: 501 },
    );
  }

  const signature = searchParams.get("signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";

  if (!signature || !timestamp || !nonce) {
    return NextResponse.json(
      { error: "缺少明文验签参数：需要 signature、timestamp、nonce" },
      { status: 401 },
    );
  }
  if (!wechatPlainSignatureOk(signature, timestamp, nonce)) {
    return NextResponse.json({ error: "验证失败" }, { status: 403 });
  }

  try {
    const text = await request.text();

    const getTag = (tag: string) => {
      const match = text.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>`))
        ?? text.match(new RegExp(`<${tag}>(.+?)</${tag}>`));
      return match?.[1] ?? "";
    };

    const msgType = getTag("MsgType");
    if (msgType !== "text") {
      return new NextResponse("success", { status: 200 });
    }

    const toUser = getTag("ToUserName");
    if (!toUser.trim()) {
      return NextResponse.json({ error: "缺少 ToUserName，无法关联组织" }, { status: 400 });
    }

    const resolved = await resolveInboundTradeOrgId({
      provider: "wechat",
      providerAccountId: toUser,
    });
    if (!resolved.ok) {
      logInboundOrgDenial("wechat", resolved.reason, { toUserName: toUser });
      return NextResponse.json(
        { error: "unknown_wechat_channel", detail: "未找到与 ToUserName 匹配的 TradeChannel.config" },
        { status: 403 },
      );
    }

    const fromUser = getTag("FromUserName");
    const content = getTag("Content");

    if (fromUser && content) {
      const createTime = getTag("CreateTime");
      const eventId = getTag("MsgId") || `${fromUser}:${createTime}`;
      const claim = await claimChannelEventReceipt(
        resolved.orgId,
        WECHAT_INBOUND_SOURCE,
        eventId,
        { fromUser, toUser, msgType, createTime },
        { staleMs: WECHAT_RECEIPT_STALE_MS },
      );
      // 平台重发：已处理 / 正在处理（4 秒内）→ 不再写第二条消息
      if (claim.outcome !== "claimed") return new NextResponse("success", { status: 200 });
      try {
        const r = await processInboundMessage(resolved.orgId, {
          channel: "wechat",
          from: fromUser,
          content,
          externalId: eventId,
        });
        await linkReceipt(claim.receiptId, { prospectId: r.prospectId, tradeMessageId: r.messageId });
        await releaseReceipt(claim.receiptId, "complete");
      } catch (err) {
        // 释放为 received：微信若还在重试窗口内重发，可以再处理一次
        await releaseReceipt(claim.receiptId, "received").catch(() => undefined);
        throw err;
      }
    }

    return new NextResponse("success", { status: 200 });
  } catch (e) {
    console.error("WeChat webhook error:", e);
    return new NextResponse("success", { status: 200 });
  }
}
