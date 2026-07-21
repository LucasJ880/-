/**
 * GET /api/operations/config-health
 * 经营中心：当前企业配置问题（缺失/无效/不兼容）
 */

import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { listOrgConfigIssues } from "@/lib/org-rules/service";
import { resolveIndustryPack } from "@/lib/industry-packs/registry";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const org = await db.organization.findUnique({
    where: { id: tenant.orgId },
    select: {
      id: true,
      name: true,
      code: true,
      industryPackId: true,
      modulesJson: true,
    },
  });

  const issues = await listOrgConfigIssues(tenant.orgId);
  const pack = resolveIndustryPack(org?.industryPackId, {
    fallbackGenericOnMissing: false,
  });

  return NextResponse.json({
    orgId: tenant.orgId,
    orgName: org?.name ?? null,
    orgCode: org?.code ?? null,
    industryPack:
      pack.status === "ok"
        ? { id: pack.pack.id, name: pack.pack.name, status: "ok" }
        : {
            id: org?.industryPackId ?? null,
            status: pack.status,
            message: "message" in pack ? pack.message : undefined,
          },
    issues,
    healthy: issues.length === 0 && pack.status === "ok",
  });
}
