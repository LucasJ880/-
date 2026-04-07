import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendGmail } from '@/lib/google-email';
import { formatCAD } from '@/lib/blinds/pricing-engine';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { quoteId } = await params;
  const body = await request.json();
  const { to, subject, customBody } = body as {
    to: string;
    subject?: string;
    customBody?: string;
  };

  if (!to) {
    return NextResponse.json({ error: '收件人邮箱不能为空' }, { status: 400 });
  }

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: 'asc' } },
      addons: true,
    },
  });

  if (!quote) {
    return NextResponse.json({ error: '报价单不存在' }, { status: 404 });
  }

  const emailSubject = subject || `Sunny Shutter Quote for ${quote.customer.name}`;
  const emailBody = customBody || buildQuoteEmailHtml(quote);

  const emailProvider = await db.emailProvider.findFirst({
    where: { userId: user.id },
  });

  if (!emailProvider) {
    return NextResponse.json(
      { error: '请先绑定 Gmail 邮件服务' },
      { status: 400 },
    );
  }

  try {
    const { messageId } = await sendGmail(user.id, {
      to,
      from: emailProvider.email,
      subject: emailSubject,
      body: emailBody,
    });

    await db.salesQuote.update({
      where: { id: quoteId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        emailMessageId: messageId,
      },
    });

    await db.customerInteraction.create({
      data: {
        customerId: quote.customerId,
        opportunityId: quote.opportunityId,
        type: 'email',
        direction: 'outbound',
        summary: `发送报价邮件 v${quote.version} — ${formatCAD(quote.grandTotal)}`,
        emailMessageId: messageId,
        createdById: user.id,
      },
    });

    return NextResponse.json({ messageId, status: 'sent' });
  } catch (err) {
    console.error('[sales/quotes/send-email] Error:', err);
    return NextResponse.json(
      { error: '邮件发送失败，请检查 Gmail 绑定' },
      { status: 500 },
    );
  }
}

interface QuoteForEmail {
  customer: { name: string };
  version: number;
  items: {
    product: string;
    fabric: string;
    widthIn: number;
    heightIn: number;
    cordless: boolean;
    price: number;
    installFee: number;
  }[];
  addons: { displayName: string; qty: number; subtotal: number }[];
  merchSubtotal: number;
  addonsSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  preTaxTotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
}

function buildQuoteEmailHtml(quote: QuoteForEmail): string {
  const itemRows = quote.items
    .map(
      (item, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.product} — ${item.fabric}${item.cordless ? ' (Cordless)' : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${item.widthIn}" × ${item.heightIn}"</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCAD(item.price)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCAD(item.installFee)}</td>
      </tr>`
    )
    .join('');

  const addonRows = quote.addons
    .map(
      (a) => `
      <tr>
        <td colspan="3" style="padding:8px;border-bottom:1px solid #eee">${a.displayName} × ${a.qty}</td>
        <td colspan="2" style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCAD(a.subtotal)}</td>
      </tr>`
    )
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;color:#333">
      <h2 style="color:#1a1a1a">Sunny Shutter — Quote</h2>
      <p>Dear ${quote.customer.name},</p>
      <p>Thank you for your interest in Sunny Shutter! Please find your quote below (v${quote.version}):</p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left">#</th>
            <th style="padding:8px;text-align:left">Product</th>
            <th style="padding:8px;text-align:center">Size</th>
            <th style="padding:8px;text-align:right">Price</th>
            <th style="padding:8px;text-align:right">Install</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          ${addonRows}
        </tbody>
      </table>

      <table style="width:300px;margin-left:auto;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:4px 8px">Merchandise</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.merchSubtotal)}</td></tr>
        ${quote.addonsSubtotal > 0 ? `<tr><td style="padding:4px 8px">Add-ons</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.addonsSubtotal)}</td></tr>` : ''}
        <tr><td style="padding:4px 8px">Installation</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.installApplied)}</td></tr>
        <tr><td style="padding:4px 8px">Delivery</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.deliveryFee)}</td></tr>
        <tr style="border-top:1px solid #ddd"><td style="padding:4px 8px">Subtotal</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.preTaxTotal)}</td></tr>
        <tr><td style="padding:4px 8px">Tax (${(quote.taxRate * 100).toFixed(0)}%)</td><td style="padding:4px 8px;text-align:right">${formatCAD(quote.taxAmount)}</td></tr>
        <tr style="border-top:2px solid #333;font-weight:bold;font-size:16px"><td style="padding:8px">Total</td><td style="padding:8px;text-align:right">${formatCAD(quote.grandTotal)}</td></tr>
      </table>

      <p style="margin-top:24px">If you have any questions, please don't hesitate to reach out. We look forward to working with you!</p>
      <p>Best regards,<br/>Sunny Shutter Team</p>
    </div>
  `;
}
