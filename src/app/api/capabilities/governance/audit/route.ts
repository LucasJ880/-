/**
 * GET /api/capabilities/governance/audit
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  parseDateParam,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import {
  assertCanReadGovernance,
  auditWorkspaceRestriction,
  listCapabilityAudit,
} from "@/lib/capabilities/governance";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    await assertCanReadGovernance(access);
    const sp = request.nextUrl.searchParams;
    const to = parseDateParam(sp.get("to"), new Date());
    const from = parseDateParam(
      sp.get("from"),
      new Date(to.getTime() - 30 * 86400000),
    );

    const restrict = auditWorkspaceRestriction(access);
    if (restrict !== null && restrict.length === 0) {
      return NextResponse.json(
        { error: "无权查看企业治理审计", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const result = await listCapabilityAudit({
      orgId: access.orgId,
      workspaceId: sp.get("workspaceId"),
      actorUserId: sp.get("actor") ?? undefined,
      action: sp.get("action") ?? undefined,
      resourceType: sp.get("resourceType") ?? undefined,
      riskLevel: sp.get("riskLevel") ?? undefined,
      traceId: sp.get("traceId") ?? undefined,
      from,
      to,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 20,
      restrictWorkspaceIds: restrict,
    });

    return NextResponse.json({ ...result, orgId: access.orgId });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
