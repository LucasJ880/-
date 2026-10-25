/**
 * POST /api/trade/webhook/email — 邮件转发询盘入站（Resend Inbound「email.received」），处理见 src/lib/trade/email-inbound.ts。
 * 鉴权：Resend（Svix）签名，密钥 RESEND_INBOUND_WEBHOOK_SECRET，先于任何 DB 访问；组织只由收件别名在服务端解析。
 * 状态：未配置密钥 503；正文超过 5 MB 413；签名缺失 / 错误 / 时间戳超出 5 分钟 401；签名通过但不是 JSON 400。
 * maxDuration 300：after() 里的 FDE 计入本函数时长（与网站 webhook 一致）。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyResendWebhookSignature } from "@/lib/trade/email-inbound-rules";
import { handleResendInboundEvent } from "@/lib/trade/email-inbound";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 远大于 Resend 事件（事件只带元数据，正文 / 附件另取）；在读正文、算 HMAC 之前拒绝 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "inbound email webhook not configured" }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  const verified = verifyResendWebhookSignature(
    rawBody,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
  );
  if (!verified.ok) {
    if (verified.reason === "secret_misconfigured") {
      console.error("[email-inbound] RESEND_INBOUND_WEBHOOK_SECRET is not a valid Svix secret");
      return NextResponse.json({ error: "inbound email webhook not configured" }, { status: 503 });
    }
    if (verified.reason === "invalid_payload") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // 签名通过之后才访问 DB
  try {
    const result = await handleResendInboundEvent(verified.event, {
      domain: process.env.INBOUND_EMAIL_DOMAIN,
      trustedAuthServId: process.env.INBOUND_EMAIL_AUTHSERV_ID,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[email-inbound] handling failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
