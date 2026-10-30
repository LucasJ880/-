/**
 * GET /api/accounting/projects[?quarter=YYYY-Qn]
 *
 * PERM-5a：项目结算汇总（project.finance.read）。ORG = 全企业已派发项目；ASSIGNED = 本人是成员 / 负责人的项目。
 * 只给汇总，不给逐笔费用 / 收据（拍板 3）；与销售成交分开（独立接口、独立页签）。
 * 项目财务控制未启用 → 200 + available:false。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { resolveProjectFinanceScope } from "@/lib/accounting/access";
import { parseQuarter } from "@/lib/accounting/period";
import { loadProjectSettlements } from "@/lib/accounting/service";

export const GET = withAuth(async (request, _ctx, user) => {
  const sp = request.nextUrl.searchParams;
  const orgRes = await resolveRequestOrgIdForUser(user, sp.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveProjectFinanceScope(user, orgRes.orgId);
  if (!scope) {
    return NextResponse.json({ error: "无权查看项目结算", code: "ACCOUNTING_PERMISSION_REQUIRED" }, { status: 403 });
  }

  const quarter = parseQuarter(sp.get("quarter"));
  if (quarter === "invalid") return NextResponse.json({ error: "quarter 格式应为 YYYY-Qn" }, { status: 400 });

  return NextResponse.json({ scope, ...(await loadProjectSettlements(orgRes.orgId, scope, user.id, quarter)) });
});
