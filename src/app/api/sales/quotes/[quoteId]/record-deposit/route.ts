import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isAcceptedDepositPaymentMethod } from "@/lib/sales/deposit-payment-methods";
import { assertSalesQuoteUpdatable, resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

/**
 * POST /api/sales/quotes/[quoteId]/record-deposit
 *
 * 客户签字后，销售线下收到定金时补录收款信息：
 *   - amount: 金额（>= 0，允许 0 表示免收）
 *   - method: cash | visa | check | finance（兼容旧客户端 etransfer）
 *   - note: 可选备注
 *
 * 权限（PERM-4a）：报价限当前企业（跨企业 404）；对该报价持 sales.quote.update（本人范围 = 本人创建）
 * 只能在 status=signed 或 accepted（历史）时补录，其他状态拒绝。
 */

type Body = {
  amount?: number;
  method?: string;
  note?: string | null;
};

export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "金额必须是非负数字" }, { status: 400 });
  }

  const method = (body.method || "").trim().toLowerCase();
  if (!isAcceptedDepositPaymentMethod(method)) {
    return NextResponse.json(
      { error: "支付方式必须是 Cash、Visa、支票或 Finance 之一" },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: {
      id: true,
      createdById: true,
      status: true,
      grandTotal: true,
      depositCollectedAt: true,
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  const denied = await assertSalesQuoteUpdatable(user, orgRes.orgId, quote);
  if (denied) return denied;

  // 仅允许对"已签约"（signed / accepted 历史数据）补录定金
  if (quote.status !== "signed" && quote.status !== "accepted") {
    return NextResponse.json(
      { error: "仅已签约订单可登记定金，请先让客户完成签字" },
      { status: 409 },
    );
  }

  const updated = await db.salesQuote.update({
    where: { id: quote.id },
    data: {
      depositAmount: amount,
      depositMethod: method,
      depositCollectedAt: new Date(),
      depositCollectedById: user.id,
      depositNote: note || null,
    },
    select: {
      id: true,
      depositAmount: true,
      depositMethod: true,
      depositCollectedAt: true,
      depositCollectedById: true,
      depositNote: true,
      grandTotal: true,
    },
  });

  return NextResponse.json({
    ok: true,
    quote: updated,
    balance: Number((quote.grandTotal - amount).toFixed(2)),
  });
});
