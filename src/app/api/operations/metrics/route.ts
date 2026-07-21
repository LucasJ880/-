/**
 * GET /api/operations/metrics
 * 当前企业的经营指标定义（无定义时明确 missing，不写死企业名）
 */

import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { listMetricDefinitions } from "@/lib/metrics/definitions";

export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const result = await listMetricDefinitions(tenant.orgId);
  return NextResponse.json({
    orgId: tenant.orgId,
    configStatus: result.configStatus,
    message: result.message,
    metrics: result.metrics,
  });
}
