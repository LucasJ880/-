/**
 * GET /api/accounting/sales-summary?month=YYYY-MM[&format=csv]
 *
 * PERM-5a：会计看全员成交与提成（accounting.read，ORG）。口径与本人提成接口同一纯函数；
 * 不出逐行成本与客户资料（拍板 2）。format=csv 导出并写审计 accounting.export。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { logAudit } from "@/lib/audit/logger";
import { ACCOUNTING_READ, requireAccountingPermissions } from "@/lib/accounting/access";
import { parseMonth } from "@/lib/accounting/period";
import { loadSalesSummary } from "@/lib/accounting/service";
import { toCsv } from "@/lib/accounting/csv";

export const GET = withAuth(async (request, _ctx, user) => {
  const sp = request.nextUrl.searchParams;
  const orgRes = await resolveRequestOrgIdForUser(user, sp.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireAccountingPermissions(user, orgRes.orgId, [ACCOUNTING_READ]);
  if (denied) return denied;

  const month = parseMonth(sp.get("month"));
  if (!month) return NextResponse.json({ error: "month 格式应为 YYYY-MM" }, { status: 400 });

  const summary = await loadSalesSummary(orgRes.orgId, month);
  if (sp.get("format") !== "csv") return NextResponse.json(summary);

  const csv = toCsv(
    ["销售", "签约单数", "成交金额", "真实毛利", "提成", "有成本单数", "已覆盖行 / 总行"],
    summary.bySales.map((r) => [
      r.salesName,
      r.quotesSigned,
      r.signedAmount,
      r.realMargin,
      r.realCommission,
      r.quotesWithCost,
      `${r.itemsCosted}/${r.itemsTotal}`,
    ]),
  );
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "accounting.export",
    targetType: "accounting_sales_summary",
    targetId: month.label,
    afterData: { month: month.label, rows: summary.bySales.length },
    request,
  });
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sales-summary-${month.label}.csv"`,
    },
  });
});
