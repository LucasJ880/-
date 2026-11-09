/**
 * GET /api/ops/sales-summary（OPS-REV）
 * 运营中心只读的「全公司销售额」：本周 / 本月至今的成单金额、成单数、报价金额。
 *   - 授权：全企业范围的 sales.revenue.summary.read（运营主管 / 运营人员）或 sales.analytics.read；只有本人范围 → 403
 *   - 只返回汇总数字：没有客户、报价 id、按销售员的明细
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { canReadOrgRevenueSummary, loadOrgRevenueSummary } from "@/lib/sales/period/revenue-summary";

export const GET = withAuth(async (_request, _ctx, user) => {
  const resolved = await resolvePreferredOrgId(user.id, user.role);
  if (!resolved.orgId) {
    return NextResponse.json({ error: "请先选择企业", code: "ORG_REQUIRED" }, { status: 400 });
  }
  if (!(await canReadOrgRevenueSummary(user, resolved.orgId))) {
    return NextResponse.json({ error: "无权查看销售额汇总", code: "SALES_SUMMARY_FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json(await loadOrgRevenueSummary(resolved.orgId));
});
