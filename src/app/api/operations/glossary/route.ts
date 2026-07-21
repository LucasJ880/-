/**
 * GET /api/operations/glossary
 * 当前企业术语表（TenantContext.orgId；禁止跨企业）
 */

import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { listGlossaryForOrg } from "@/lib/glossary/service";

export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (workspaceId && tenant.workspaceIds && !tenant.workspaceIds.includes(workspaceId)) {
    // 若未 loadWorkspaces，做一次轻量校验
    if (tenant.orgRole !== "org_admin") {
      const access = await import("@/lib/tenancy").then((m) =>
        m.requireWorkspaceAccess(tenant, workspaceId),
      );
      if (!access.ok) return access.response;
    }
  }

  const terms = await listGlossaryForOrg({
    orgId: tenant.orgId,
    workspaceId,
  });

  return NextResponse.json({
    orgId: tenant.orgId,
    workspaceId: workspaceId || null,
    configStatus: terms.length > 0 ? "ok" : "missing",
    terms,
  });
}
