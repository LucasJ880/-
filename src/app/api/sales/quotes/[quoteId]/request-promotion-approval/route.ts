import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { createNotificationsForUsers } from "@/lib/notifications/create";

/**
 * 保存后的超额 Special Promotion 报价，提交给可越过该上限的平台管理员审核。
 * 报价本身保持 draft；管理员从站内通知直达编辑页，确认后再保存/发送。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: {
      id: true,
      orgId: true,
      createdById: true,
      orderNumber: true,
      specialPromotion: true,
      finalDiscountPct: true,
      updatedAt: true,
      customer: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (quote.createdById !== user.id && !isAdmin(user.role)) {
    return NextResponse.json({ error: "只能提交自己创建的报价单" }, { status: 403 });
  }

  const settings = await db.quoteDiscountSettings.findUnique({
    where: { orgId: orgRes.orgId },
    select: { promoMaxPct: true },
  });
  const maxPct = settings?.promoMaxPct ?? 0.25;
  const ratio = quote.finalDiscountPct ?? 0;
  if (ratio <= maxPct) {
    return NextResponse.json(
      { error: "当前 Special Promotion 未超过公司上限，无需提交审核" },
      { status: 400 },
    );
  }

  // 必须与前端 promoBlocked 的豁免角色一致；否则收件人打开后仍无法确认/提交。
  const platformAdmins = await db.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, status: "active" },
    select: { id: true },
  });

  const recipientIds = new Set<string>(platformAdmins.map((a) => a.id));
  recipientIds.delete(user.id);

  if (recipientIds.size === 0) {
    return NextResponse.json(
      { error: "系统中尚未配置可接收审核的平台管理员" },
      { status: 409 },
    );
  }

  const orderLabel = quote.orderNumber || quote.id;
  const requester = quote.createdBy.name || quote.createdBy.email;
  const href = `/sales/quote-sheet?mode=order&quoteId=${encodeURIComponent(quote.id)}`;
  const notified = await createNotificationsForUsers([...recipientIds], {
    sourceKeyPrefix: `quote-promotion-approval:${quote.id}:${quote.updatedAt.getTime()}`,
    orgId: orgRes.orgId,
    type: "quote_promotion_approval",
    category: "approval",
    title: `报价 ${orderLabel} 请求超额让利审核`,
    summary:
      `${requester} 为客户 ${quote.customer.name} 提交了 ` +
      `${(ratio * 100).toFixed(1)}% 的 Special Promotion（上限 ${(maxPct * 100).toFixed(1)}%）。`,
    entityType: "sales_quote",
    entityId: quote.id,
    priority: "high",
    metadata: {
      href,
      promotionRatio: ratio,
      promotionAmount: quote.specialPromotion ?? 0,
      maxPct,
      requesterUserId: user.id,
    },
  });

  return NextResponse.json({ ok: true, notified, quoteId: quote.id });
});
