/**
 * WeChat Official Account / WeCom Webhook
 *
 * GET  — 微信服务器验证
 * POST — 接收消息
 *
 * 注意: MVP 阶段明文模式，后续可加密
 */

import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/trade/channel-service";
import crypto from "crypto";

const TOKEN = process.env.WECHAT_TOKEN;

export async function GET(request: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";
  const echostr = searchParams.get("echostr") ?? "";

  const arr = [TOKEN, timestamp, nonce].sort();
  const hash = crypto.createHash("sha1").update(arr.join("")).digest("hex");

  if (hash === signature) {
    return new NextResponse(echostr, { status: 200 });
  }
  return NextResponse.json({ error: "验证失败" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
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

    const fromUser = getTag("FromUserName");
    const content = getTag("Content");

    if (fromUser && content) {
      await processInboundMessage("default", {
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
