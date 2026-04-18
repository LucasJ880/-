import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { onQuoteSigned } from "@/lib/sales/opportunity-lifecycle";
import { isSuperAdmin } from "@/lib/rbac/roles";

/**
 * POST /api/sales/quotes/[quoteId]/mark-signed
 *
 * 现场销售看到客户当面签字后调用：
 *   1) 把 SalesQuote 标记为 signed（记录签名时间）
 *   2) 通过 onQuoteSigned 把关联的 Opportunity 推进到 stage=signed（已成单），并回填 wonAt
 */
export const POST = withAuth(async (_request, ctx, user) => {
  const { quoteId } = await ctx.params;

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: { id: true, createdById: true, opportunityId: true, status: true },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  // 权限：只能是创建者或超管
  if (quote.createdById !== user.id && !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权操作此报价单" }, { status: 403 });
  }

  await db.salesQuote.update({
    where: { id: quoteId },
    data: {
      status: "signed",
      signedAt: new Date(),
    },
  });

  // 推进商机到 signed（已成单），容错：失败不阻断
  const lifecycle = await onQuoteSigned(quoteId).catch((err) => {
    console.error("[mark-signed] lifecycle advance failed:", err);
    return null;
  });

  return NextResponse.json({
    ok: true,
    quoteId,
    opportunityId: quote.opportunityId,
    stageAdvanced: lifecycle?.advanced ?? false,
    newStage: lifecycle?.newStage ?? null,
  });
});
