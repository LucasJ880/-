/**
 * WhatsApp Cloud API Webhook（处理见 src/lib/trade/whatsapp-inbound.ts；maxDuration 300：after() 里的 FDE 计入本函数时长）
 * GET  — Meta 验证请求（WHATSAPP_VERIFY_TOKEN；未配置 403）
 * POST — X-Hub-Signature-256 + WHATSAPP_APP_SECRET（未配置 503，签名错 401，非 JSON 400）；org 由 phone_number_id 解析。
 *        有条目失败 / busy → 500 让 Meta 重投整批（按收据幂等）；其余 200（未知 phone_number_id 的条目只跳过）。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsAppSignature } from "@/lib/trade/webhook-meta";
import { processWhatsAppWebhook } from "@/lib/trade/whatsapp-inbound";

export const runtime = "nodejs";
export const maxDuration = 300;

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET?.trim();

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

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const outcome = await processWhatsAppWebhook(body);
  if (outcome.failed > 0 || outcome.busy > 0) {
    // 至少一次：让 Meta 重投整批；已处理的条目按收据幂等
    return NextResponse.json({ status: "retry" }, { status: 500 });
  }
  return NextResponse.json({ status: "ok" });
}
