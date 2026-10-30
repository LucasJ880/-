import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { sendSalesEmail } from "@/lib/email/sender";
import { quoteEmailHtml } from "@/lib/email/templates";
import { deriveQuoteDisplayAmounts } from "@/lib/sales/quote-display-amounts";
import { randomBytes } from "crypto";
import { authorize, humanPrincipal } from "@/lib/authorization";
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
} from "@/lib/sales/org-context";
import { evaluatePromotionApproval } from "@/lib/sales/promotion-approval";

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
    { user, permission: "sales.customer.read" },
  );
  if (custDenied) return custDenied;

  // PERM-2：发送权限按岗位（销售本人 / 合价全企业 / 平台管理员）；超限未批一律 409
  const sendAuthz = await authorize({
    principal: humanPrincipal(user, requestOrgId),
    orgId: requestOrgId,
    permission: "sales.quote.send",
    resource: { type: "sales_quote", id: quote.id, ownerId: quote.createdById, orgId: requestOrgId },
  });
  if (!sendAuthz.allowed) {
    return NextResponse.json({ error: "无权发送此报价单", code: sendAuthz.reasonCode }, { status: 403 });
  }

  {
    const settings = await db.quoteDiscountSettings.findUnique({
      where: { orgId: requestOrgId },
      select: { promoMaxPct: true },
    });
    const promotion = evaluatePromotionApproval(quote, settings?.promoMaxPct ?? 0.25);
    if (promotion.required && !promotion.approved) {
      return NextResponse.json({ error: promotion.reason, code: "PROMOTION_APPROVAL_REQUIRED" }, { status: 409 });
    }
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

  // 对客金额以销售端表单约定的 定金+尾款 为准（DB grandTotal 在 shell/partial
  // 保存或含 Part B/让利时不可靠，历史上会显示 0）
  const amounts = deriveQuoteDisplayAmounts(quote.formDataJson, quote.grandTotal);

  const total = `CA$${amounts.total.toFixed(2)}`;
  const subjectMap: Record<string, string> = {
    en: `Your Personalized Quote — SUNNY HOME & DECO · ${total}`,
    cn: `您的定制报价 — SUNNY HOME & DECO · ${total}`,
    fr: `Votre devis personnalisé — SUNNY HOME & DECO · ${total}`,
  };

  const html = quoteEmailHtml({
    customerName: quote.customer.name,
    quoteUrl,
    grandTotal: amounts.total,
    depositDue: amounts.deposit,
    balance: amounts.balance,
    balanceText: amounts.balanceText,
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
      summary: `发送报价邮件 v${quote.version} (${emailLang.toUpperCase()}) — $${amounts.total.toFixed(2)}`,
      emailMessageId: result.messageId || null,
      createdById: user.id,
    },
  });

  return NextResponse.json({
    messageId: result.messageId,
    status: "sent",
    quoteUrl,
    shareToken,
    customerId: quote.customerId,
    opportunityId: quote.opportunityId,
  });
});
