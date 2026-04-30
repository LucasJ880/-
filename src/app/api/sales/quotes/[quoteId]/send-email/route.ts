import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { sendSalesEmail } from "@/lib/email/sender";
import { quoteEmailHtml } from "@/lib/email/templates";
import { randomBytes } from "crypto";
import { isSuperAdmin } from "@/lib/rbac/roles";
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
} from "@/lib/sales/org-context";

export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const body = await request.json();
  const rawBody = body as Record<string, unknown>;
  const orgRes = await resolveSalesOrgIdForRequest(request as NextRequest, user, {
    bodyOrgId: typeof rawBody.orgId === "string" ? rawBody.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const requestOrgId = orgRes.orgId;

  const { to, lang } = body as { to: string; lang?: string };

  if (!to) {
    return NextResponse.json({ error: "收件人邮箱不能为空" }, { status: 400 });
  }

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" } },
      addons: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!quote) return NextResponse.json({ error: "报价单不存在" }, { status: 404 });

  const custDenied = await assertSalesCustomerInOrgForMutation(
    {
      orgId: quote.customer.orgId,
      createdById: quote.customer.createdById,
    },
    requestOrgId,
  );
  if (custDenied) return custDenied;

  if (quote.createdById !== user.id && !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权操作此报价单" }, { status: 403 });
  }

  let shareToken = quote.shareToken;
  if (!shareToken) {
    shareToken = randomBytes(16).toString("hex");
    await db.salesQuote.update({
      where: { id: quoteId },
      data: { shareToken },
    });
  }

  const emailLang = (lang === "cn" || lang === "fr") ? lang : "en";
  const origin = request.headers.get("origin") || request.headers.get("host") || "";
  const protocol = origin.startsWith("http") ? "" : "https://";
  const quoteUrl = `${protocol}${origin}/quote/${shareToken}?lang=${emailLang}`;

  const total = `CA$${quote.grandTotal.toFixed(2)}`;
  const subjectMap: Record<string, string> = {
    en: `Your Personalized Quote — SUNNY HOME & DECO · ${total}`,
    cn: `您的定制报价 — SUNNY HOME & DECO · ${total}`,
    fr: `Votre devis personnalisé — SUNNY HOME & DECO · ${total}`,
  };

  const html = quoteEmailHtml({
    customerName: quote.customer.name,
    quoteUrl,
    grandTotal: quote.grandTotal,
    lang: emailLang,
    senderName: quote.createdBy?.name || user.name,
  });

  const result = await sendSalesEmail(user.id, {
    to,
    subject: subjectMap[emailLang],
    html,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || "发送失败" }, { status: 500 });
  }

  await db.salesQuote.update({
    where: { id: quoteId },
    data: {
      status: "sent",
      sentAt: new Date(),
      emailMessageId: result.messageId || null,
    },
  });

  await db.customerInteraction.create({
    data: {
      orgId: requestOrgId,
      customerId: quote.customerId,
      opportunityId: quote.opportunityId,
      type: "email",
      direction: "outbound",
      summary: `发送报价邮件 v${quote.version} (${emailLang.toUpperCase()}) — $${quote.grandTotal.toFixed(2)}`,
      emailMessageId: result.messageId || null,
      createdById: user.id,
    },
  });

  return NextResponse.json({ messageId: result.messageId, status: "sent" });
});
