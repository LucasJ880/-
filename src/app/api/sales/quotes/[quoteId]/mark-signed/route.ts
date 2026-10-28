import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { onQuoteSigned } from "@/lib/sales/opportunity-lifecycle";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { parseAgreedPaymentFromFormDataJson } from "@/lib/sales/quote-agreed-payment";
import { assertSalesQuoteUpdatable, resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { evaluatePromotionApproval } from "@/lib/sales/promotion-approval";
import { generateForSignedQuote } from "@/lib/sunny-process/server";

/**
 * POST /api/sales/quotes/[quoteId]/mark-signed
 *
 * 现场销售看到客户当面签字后调用：
 *   1) 把 SalesQuote 标记为 signed（记录签名时间）
 *   2) 通过 onQuoteSigned 把关联的 Opportunity 推进到 stage=signed（已成单），并回填 wonAt
 *   3) 自动生成草稿工艺单（幂等；失败不影响签字，结果在 processOrder 里回传）
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: {
      id: true,
      createdById: true,
      opportunityId: true,
      status: true,
      formDataJson: true,
      grandTotal: true,
      specialPromotion: true,
      finalDiscountPct: true,
      promotionApprovalStatus: true,
      promotionApprovalAmount: true,
      promotionApprovalRatio: true,
      promotionApprovalMaxPct: true,
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  // PERM-4a：对该报价持 sales.quote.update（本人范围 = 本人创建；合价 / 老板 ORG）
  const denied = await assertSalesQuoteUpdatable(user, orgRes.orgId, quote);
  if (denied) return denied;
  // 超限未批拦截只对平台 super_admin 放行（PERM-2 自批口径；平台 admin 不放行）
  if (!isPlatformSuperAdmin(user.role)) {
    const settings = await db.quoteDiscountSettings.findUnique({ where: { orgId: orgRes.orgId }, select: { promoMaxPct: true } });
    const promotion = evaluatePromotionApproval(quote, settings?.promoMaxPct ?? 0.25);
    if (promotion.required && !promotion.approved) {
      return NextResponse.json({ error: promotion.reason, code: "PROMOTION_APPROVAL_REQUIRED" }, { status: 409 });
    }
  }

  const agreed = parseAgreedPaymentFromFormDataJson(
    quote.formDataJson,
    quote.grandTotal,
  );

  await db.salesQuote.update({
    where: { id: quoteId },
    data: {
      status: "signed",
      signedAt: new Date(),
      agreedDepositAmount: agreed.agreedDepositAmount,
      agreedBalanceAmount: agreed.agreedBalanceAmount,
    },
  });

  // 推进商机到 signed（已成单），容错：失败不阻断
  const lifecycle = await onQuoteSigned(quoteId).catch((err) => {
    console.error("[mark-signed] lifecycle advance failed:", err);
    return null;
  });

  const processOrder = await generateForSignedQuote(quoteId);

  return NextResponse.json({
    ok: true,
    quoteId,
    opportunityId: quote.opportunityId,
    stageAdvanced: lifecycle?.advanced ?? false,
    newStage: lifecycle?.newStage ?? null,
    processOrder,
  });
});
