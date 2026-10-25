/**
 * WhatsApp Cloud API Webhook
 *
 * GET  — 验证 webhook（Meta 验证请求）
 * POST — 接收消息（须校验 X-Hub-Signature-256 + WHATSAPP_APP_SECRET；org 由 metadata.phone_number_id → TradeChannel 解析）
 *
 * 每条消息：收据（orgId, "whatsapp", wamid）→ Trade 线索 / 消息 → Revenue Spine intake（按电话 E.164 去重）
 * 后立即返回；FDE 由 after() 在响应之后执行（原子认领，cron 兜底），请求路径里没有 LLM。见 whatsapp-inbound.ts。
 * 未知 / 缺失 phone_number_id 的条目只跳过该条目（整批仍 200）。有条目处理失败或收据被占用 → 500，Meta 重投整批，
 * 已处理的条目按收据幂等（不重复建对象）。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsAppSignature } from "@/lib/trade/webhook-meta";
import { processWhatsAppWebhook } from "@/lib/trade/whatsapp-inbound";

export const runtime = "nodejs";
// 请求路径（验签 + 逐条 收据 / Trade / Revenue Spine intake）只有 DB 往返；after() 里的 FDE 同样计入本函数的
// maxDuration，与网站 webhook 一样保持 300（FDE 认领过期 / 收据处理过期都大于 300 s）。
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
