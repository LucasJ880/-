/**
 * 公开签名 API — 客户在公开报价页签名确认
 * 无需登录，通过 shareToken 定位报价
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendMailAs } from "@/lib/email/sender";
import { signedNotifyHtml } from "@/lib/email/templates";
import { onQuoteSigned } from "@/lib/sales/opportunity-lifecycle";
import { parseAgreedPaymentFromFormDataJson } from "@/lib/sales/quote-agreed-payment";
import { resolveOrgIdForQuoteLinkedInteraction } from "@/lib/sales/org-context";

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
      customer: { select: { name: true, orgId: true } },
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
  const agreed = parseAgreedPaymentFromFormDataJson(
    quote.formDataJson,
    quote.grandTotal,
  );

  // 有 PDF 存档时，把签名盖进 PDF 生成已签署版本（客户签的就是发出去的那份）。
  // 盖章失败不阻断签署主流程——签名图与时间仍落库，可事后补生成。
  let signedPdfPath: string | null = null;
  if (quote.pdfPath) {
    try {
      const { stampSignatureIntoQuotePdf } = await import(
        "@/lib/sales/quote-pdf-stamp"
      );
      signedPdfPath = await stampSignatureIntoQuotePdf({
        quoteId: quote.id,
        pdfPath: quote.pdfPath,
        signatureDataUrl,
        customerName: quote.customer.name,
        orderNumber: quote.orderNumber,
        signedAt: now,
      });
    } catch (err) {
      console.error(`[sign] PDF 签名盖章失败 quote=${quote.id}:`, err);
    }
  }

  await db.salesQuote.update({
    where: { id: quote.id },
    data: {
      signatureUrl: signatureDataUrl,
      signedAt: now,
      ...(signedPdfPath ? { signedPdfPath } : {}),
      // 公开页签字 = 销售端"生成订单" → 统一写 signed，避免"已签约"筛选
      // 与驾驶舱统计看不到这种单（历史 accepted 数据在前端和 metrics 里兼容）
      status: "signed",
      agreedDepositAmount: agreed.agreedDepositAmount,
      agreedBalanceAmount: agreed.agreedBalanceAmount,
    },
  });

  const interactionOrgId = await resolveOrgIdForQuoteLinkedInteraction({
    quoteOrgId: quote.orgId,
    customerId: quote.customerId,
    createdById: quote.createdBy.id,
  });

  // P2 guard：禁止写入 orgId:null 的 CustomerInteraction。
  // 正常数据 quote.orgId 必然存在；若解析失败属数据异常，记录错误并跳过互动创建，
  // 不阻断签署主流程（报价已置为 signed）。
  if (interactionOrgId) {
    await db.customerInteraction.create({
      data: {
        orgId: interactionOrgId,
        customerId: quote.customerId,
        type: "signature",
        direction: "inbound",
        summary: `客户签署报价单 — $${quote.grandTotal.toFixed(2)}`,
        createdById: quote.createdBy.id,
      },
    });
  } else {
    console.error(
      `[sign] 无法解析 orgId，跳过签署互动创建（防 null orgId）: quote=${quote.id} customer=${quote.customerId}`,
    );
  }

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
