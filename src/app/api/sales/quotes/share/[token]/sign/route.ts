/**
 * 公开签名 API — 客户在公开报价页签名确认
 * 无需登录，通过 shareToken 定位报价
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendMailAs } from "@/lib/email/sender";
import { signedNotifyHtml } from "@/lib/email/templates";
import { onQuoteSigned } from "@/lib/sales/opportunity-lifecycle";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json();
  const { signatureDataUrl } = body as {
    signatureDataUrl: string;
  };

  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const quote = await db.salesQuote.findUnique({
    where: { shareToken: token },
    include: {
      customer: { select: { name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  if (quote.signedAt) {
    return NextResponse.json({ error: "Already signed" }, { status: 409 });
  }

  const now = new Date();

  await db.salesQuote.update({
    where: { id: quote.id },
    data: {
      signatureUrl: signatureDataUrl,
      signedAt: now,
      status: "accepted",
    },
  });

  await db.customerInteraction.create({
    data: {
      customerId: quote.customerId,
      type: "signature",
      direction: "inbound",
      summary: `客户签署报价单 — $${quote.grandTotal.toFixed(2)}`,
      createdById: quote.createdBy.id,
    },
  });

  // 自动推进商机到 signed
  onQuoteSigned(quote.id).catch((err) =>
    console.error("Quote signed lifecycle error:", err),
  );

  // --- 三通道签约通知 ---
  const salesUserId = quote.createdBy.id;
  const salesName = quote.createdBy.name || "Sales";
  const customerName = quote.customer.name;

  // 1) 站内通知
  const { createNotification } = await import("@/lib/notifications/create");
  await createNotification({
    userId: salesUserId,
    type: "quote_signed",
    title: `报价已签约 — ${customerName}`,
    summary: `${customerName} 签署了报价单，总额 $${quote.grandTotal.toFixed(2)}`,
    metadata: { customerId: quote.customerId },
  }).catch(() => {});

  // 2) 微信推送
  try {
    const { pushNotification } = await import("@/lib/messaging/push-service");
    await pushNotification(
      salesUserId,
      "✅ 报价已签约",
      `${customerName} 签署了报价单\n总额 $${quote.grandTotal.toFixed(2)}`,
    );
  } catch {}

  // 3) 邮件通知销售
  const origin = request.headers.get("origin") || request.headers.get("host") || "";
  const protocol = origin.startsWith("http") ? "" : "https://";
  const quoteUrl = `${protocol}${origin}/sales/customers/${quote.customerId}`;

  await sendMailAs(salesUserId, {
    to: quote.createdBy.email || "",
    subject: `报价已签约 — ${customerName} $${quote.grandTotal.toFixed(2)}`,
    html: signedNotifyHtml({
      salesName,
      customerName,
      grandTotal: quote.grandTotal,
      signedAt: now.toLocaleString("zh-CN"),
      quoteUrl,
      lang: "cn",
    }),
  }).catch(() => {});

  return NextResponse.json({ signed: true, signedAt: now.toISOString() });
}
