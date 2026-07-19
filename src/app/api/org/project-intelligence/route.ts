/**
 * GET /api/org/project-intelligence?orgId=
 * 组织级项目智能汇总：规则 / 供应商表现 / 价格趋势 / 客户竞争规律 / 图谱摘要
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listOrgProjectRules } from "@/lib/projects/org-rules";
import { getOrgSupplierPerformance } from "@/lib/projects/supplier-performance";
import { getOrgPriceTrends } from "@/lib/projects/price-trends";
import {
  getOrgClientCompetitorPatterns,
  getOrgProjectGraphSummary,
} from "@/lib/projects/org-patterns";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const orgId = orgRes.orgId;
  const [rules, suppliers, prices, patterns, graph] = await Promise.all([
    listOrgProjectRules({ orgId }),
    getOrgSupplierPerformance({ orgId }),
    getOrgPriceTrends({ orgId }),
    getOrgClientCompetitorPatterns(orgId),
    getOrgProjectGraphSummary(orgId),
  ]);

  return NextResponse.json({
    orgId,
    rules,
    suppliers,
    prices,
    patterns,
    graph,
  });
});
