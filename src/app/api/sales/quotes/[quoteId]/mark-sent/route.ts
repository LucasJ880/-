import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { evaluatePromotionApproval } from "@/lib/sales/promotion-approval";

/**
 * POST /api/sales/quotes/[quoteId]/mark-sent
 *
 * 销售在"发送 Quote"里选择本地保存 PDF 后调用：
 *   - 把 SalesQuote 标记为 sent（记录 sentAt）
 *   - 不推进 opportunity 阶段：quote 在创建时已经把商机推进到 quoted，
 *     这里仅是"销售已经把报价交付给客户"的业务留痕
 *   - 已经 signed 的不回退，也不重复覆盖 sentAt
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: { id: true, createdById: true, status: true, sentAt: true, specialPromotion: true, finalDiscountPct: true, promotionApprovalStatus: true, promotionApprovalAmount: true, promotionApprovalRatio: true, promotionApprovalMaxPct: true },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  if (quote.createdById !== user.id && !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权操作此报价单" }, { status: 403 });
  }
  if (!isSuperAdmin(user.role)) {
    const settings = await db.quoteDiscountSettings.findUnique({ where: { orgId: orgRes.orgId }, select: { promoMaxPct: true } });
    const promotion = evaluatePromotionApproval(quote, settings?.promoMaxPct ?? 0.25);
    if (promotion.required && !promotion.approved) {
      return NextResponse.json({ error: promotion.reason, code: "PROMOTION_APPROVAL_REQUIRED" }, { status: 409 });
    }
  }

  if (quote.status === "signed") {
    return NextResponse.json({
      ok: true,
      quoteId,
      status: quote.status,
      skipped: true,
    });
  }

  await db.salesQuote.update({
    where: { id: quoteId },
    data: {
      status: "sent",
      sentAt: quote.sentAt ?? new Date(),
    },
  });

  return NextResponse.json({ ok: true, quoteId, status: "sent" });
});
