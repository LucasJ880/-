/**
 * GET /api/accounting/quotes?month=YYYY-MM[&salesId=][&status=]
 *
 * PERM-5a：会计看报价全过程（accounting.read + sales.quote.read，均 ORG）。
 * 显式字段：金额 / 折扣 / 超限审批状态与审批人 / 签约时间；不出客户联系方式、备注、成本、签名与 PDF。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { ACCOUNTING_READ, requireAccountingPermissions } from "@/lib/accounting/access";
import { parseMonth } from "@/lib/accounting/period";
import { loadQuoteProcess } from "@/lib/accounting/service";

export const GET = withAuth(async (request, _ctx, user) => {
  const sp = request.nextUrl.searchParams;
  const orgRes = await resolveRequestOrgIdForUser(user, sp.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireAccountingPermissions(user, orgRes.orgId, [ACCOUNTING_READ, "sales.quote.read"]);
  if (denied) return denied;

  const month = parseMonth(sp.get("month"));
  if (!month) return NextResponse.json({ error: "month 格式应为 YYYY-MM" }, { status: 400 });

  return NextResponse.json(
    await loadQuoteProcess(orgRes.orgId, month, { salesId: sp.get("salesId"), status: sp.get("status") }),
  );
});
