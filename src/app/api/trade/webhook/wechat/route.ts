/**
 * WeChat Official Account / WeCom Webhook
 *
 * GET  — 微信服务器验证（明文：signature + timestamp + nonce）
 * POST — 明文：同上；若检测到加密模式参数（msg_signature / encrypt_type=aes）则返回 501 并 TODO
 */

import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/trade/channel-service";
import crypto from "crypto";
import { logInboundOrgDenial, resolveInboundTradeOrgId } from "@/lib/trade/inbound-org";

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
      await processInboundMessage(resolved.orgId, {
        channel: "wechat",
        from: fromUser,
        content,
      });
    }

    return new NextResponse("success", { status: 200 });
  } catch (e) {
    console.error("WeChat webhook error:", e);
    return new NextResponse("success", { status: 200 });
  }
}
