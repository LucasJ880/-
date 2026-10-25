/**
 * POST /api/trade/webhook/email — 邮件转发询盘入站（Resend Inbound「email.received」）
 *
 * 鉴权：Resend（Svix）签名，密钥 RESEND_INBOUND_WEBHOOK_SECRET；签名校验在任何 DB 访问之前。
 *   未配置密钥 → 503；签名缺失 / 错误 / 时间戳超出 5 分钟 → 401；签名通过但正文不是 JSON → 400。
 * 组织：只由收件别名 inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN> 在服务端解析（TradeChannel channel="email"），
 *   载荷里的任何字段都不能指定组织。
 * 处理：见 src/lib/trade/email-inbound.ts（隔离 / 双重入站判定 / 入链）。请求内只做收据 → Trade → Revenue Spine，
 *   FDE 由 after() 在响应之后执行（与网站 webhook 同一套原子认领），所以 maxDuration 与网站 webhook 一样是 300：
 *   after() 里的 FDE 计入本函数时长；与之耦合的 FDE_CLAIM_STALE_MS / RECEIPT_PROCESSING_STALE_MS 都大于 300 s。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyResendWebhookSignature } from "@/lib/trade/email-inbound-rules";
import { handleResendInboundEvent } from "@/lib/trade/email-inbound";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "inbound email webhook not configured" }, { status: 503 });
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
