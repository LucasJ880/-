/**
 * WhatsApp Cloud API Webhook
 *
 * GET  — 验证 webhook（Meta 验证请求）
 * POST — 接收消息（须校验 X-Hub-Signature-256 + WHATSAPP_APP_SECRET；org 由 metadata.phone_number_id → TradeChannel 解析）
 */

import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/trade/channel-service";
import { verifyWhatsAppSignature } from "@/lib/trade/webhook-meta";
import { logInboundOrgDenial, resolveInboundTradeOrgId } from "@/lib/trade/inbound-org";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET?.trim();

type WaMessage = {
  type?: string;
  from?: string;
  text?: { body?: string };
  id?: string;
  timestamp?: string;
};

type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: WaMessage[];
};

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
  if (!APP_SECRET) {
    return NextResponse.json(
      { error: "WHATSAPP_APP_SECRET 未配置，拒绝处理入站消息" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const sig = request.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppSignature(rawBody, sig, APP_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody) as {
      entry?: Array<{
        changes?: Array<{
          field?: string;
          value?: WaValue;
        }>;
      }>;
    };

    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id?.trim();
        if (!phoneNumberId) {
          logInboundOrgDenial("whatsapp", "missing_phone_number_id", {});
          return NextResponse.json(
            { error: "missing_phone_number_id", detail: "无法将入站消息关联到组织" },
            { status: 400 },
          );
        }

        const resolved = await resolveInboundTradeOrgId({
          provider: "whatsapp",
          providerAccountId: phoneNumberId,
        });
        if (!resolved.ok) {
          logInboundOrgDenial("whatsapp", resolved.reason, { phoneNumberId });
          return NextResponse.json(
            { error: "unknown_whatsapp_channel", detail: "未找到与 phone_number_id 匹配的 TradeChannel" },
            { status: 403 },
          );
        }

        const messages = value?.messages ?? [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          await processInboundMessage(resolved.orgId, {
            channel: "whatsapp",
            from: msg.from ?? "",
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
