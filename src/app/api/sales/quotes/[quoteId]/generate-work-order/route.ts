import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import { ensureWorkOrdersFromSignedQuote } from "@/lib/work-orders/from-signed-quote";

/**
 * POST /api/sales/quotes/[quoteId]/generate-work-order
 *
 * 手动生成/补生成工艺单。用于：
 *   - 签名时 flag 还没开（灰度期先手动跑几单验证）
 *   - 签名时生成失败（网络/DB 抖动），事后补
 *   - 报价单补全信息后重新生成
 *
 * 幂等：已生成过会直接返回那张单，不会建第二张。
 * 手动触发不受 SALES_WORKORDER_AUTOGEN_ENABLED 门控（见 EnsureOptions 注释）。
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ quoteId: string }> },
) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { quoteId } = await ctx.params;

  // 只允许操作本组织的报价单
  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: tenant.orgId },
    select: { id: true, signedAt: true, status: true },
  });
  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (!quote.signedAt) {
    return NextResponse.json(
      { error: "报价单尚未签署，签署后才能生成工艺单" },
      { status: 409 },
    );
  }

  try {
    const outcome = await ensureWorkOrdersFromSignedQuote(quoteId, { trigger: "manual" });
    return NextResponse.json(outcome);
  } catch (err) {
    console.error(`[generate-work-order] quote=${quoteId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败" },
      { status: 500 },
    );
  }
}
