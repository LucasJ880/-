import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";

/**
 * GET /api/sales/pending-deposit/summary
 *
 * 返回"已签约但未登记定金"的报价摘要，供 /sales 首页顶部 banner 与待办入口使用。
 *   - sales：仅看自己名下
 *   - admin / super_admin：看全部
 *
 * 统计口径：status IN ('signed', 'accepted') AND depositCollectedAt IS NULL。
 *   accepted 兜底历史公开签字通道留下的旧状态。
 */
export const GET = withAuth(async (_request, _ctx, user) => {
  const where = {
    status: { in: ["signed", "accepted"] },
    depositCollectedAt: null,
    ...(isAdmin(user.role) ? {} : { createdById: user.id }),
  };

  const [count, quotes] = await Promise.all([
    db.salesQuote.count({ where }),
    db.salesQuote.findMany({
      where,
      orderBy: [{ signedAt: "desc" }, { updatedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        grandTotal: true,
        signedAt: true,
        updatedAt: true,
        customerId: true,
        agreedDepositAmount: true,
        agreedBalanceAmount: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    count,
    quotes: quotes.map((q) => ({
      id: q.id,
      customerId: q.customerId,
      customerName: q.customer?.name ?? "—",
      grandTotal: q.grandTotal,
      agreedDepositAmount: q.agreedDepositAmount,
      agreedBalanceAmount: q.agreedBalanceAmount,
      signedAt: (q.signedAt ?? q.updatedAt).toISOString(),
    })),
  });
});
