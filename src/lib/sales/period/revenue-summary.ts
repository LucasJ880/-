/**
 * OPS-REV：运营中心「全公司销售额」只读汇总——取数与授权。
 * 口径见 revenue-summary-pure.ts（与销售期间汇总同一份计算，范围固定全企业）。
 */
import type { AuthUser } from "@/lib/auth";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { resolveSalesScope } from "@/lib/sales/org-context";
import { loadPeriodQuoteRows } from "./load";
import { buildOrgRevenueSummary, revenueSummaryFetchRange, revenueSummaryWindows, type OrgRevenueSummary } from "./revenue-summary-pure";

/** 只认全企业（ORG）范围：sales.revenue.summary.read（运营岗）或 sales.analytics.read（老板 / 合价 / 会计已能看更细的分析） */
export async function canReadOrgRevenueSummary(user: AuthUser, orgId: string): Promise<boolean> {
  for (const key of ["sales.revenue.summary.read", "sales.analytics.read"]) {
    const scope = await resolveSalesScope(user, orgId, key);
    if (scope.allowed && !scope.ownOnly) return true;
  }
  return false;
}

export async function loadOrgRevenueSummary(orgId: string, now: Date = new Date()): Promise<OrgRevenueSummary> {
  const timezone = await loadOrgTimezone(orgId);
  const { start, end } = revenueSummaryFetchRange(revenueSummaryWindows(now, timezone));
  const { rows, truncated } = await loadPeriodQuoteRows({ orgId, scope: { kind: "org" }, start, end });
  return buildOrgRevenueSummary({ rows, now, timezone, truncated });
}
