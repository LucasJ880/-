/**
 * GET /api/operations/brand-truth
 * 统一 Brand Truth 读取（事实主源 + 语料视图）
 */

import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { getOrgBrandTruth } from "@/lib/brand/org-brand-truth";

export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const truth = await getOrgBrandTruth(tenant.orgId);
  return NextResponse.json(truth);
}
