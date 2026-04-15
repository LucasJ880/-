/**
 * WhatsApp Cloud API Webhook
 *
 * GET  — 验证 webhook（Meta 验证请求）
 * POST — 接收消息
 */

import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/trade/channel-service";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request: NextRequest) {
  if (!VERIFY_TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "验证失败" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!VERIFY_TOKEN) {
    return NextResponse.json({ error: "Webhook 未配置" }, { status: 403 });
  }

  try {
    const body = await request.json();

    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          await processInboundMessage("default", {
            channel: "whatsapp",
            from: msg.from,
            content: msg.text?.body ?? "",
            externalId: msg.id,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
          });
        }
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("WhatsApp webhook error:", e);
    return NextResponse.json({ status: "ok" });
  }
}
