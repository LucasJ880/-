/**
 * GET /api/capabilities/governance — 治理 Read Model
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import {
  assertCanReadGovernance,
  getGovernanceProjection,
  writeCapabilityAuditEvent,
} from "@/lib/capabilities/governance";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    await assertCanReadGovernance(access);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (
      workspaceId &&
      !access.workspaceIds.includes(workspaceId) &&
      access.orgRole !== "org_admin"
    ) {
      return NextResponse.json(
        { error: "无权查看该 Workspace", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const projection = await getGovernanceProjection({
      orgId: access.orgId,
      workspaceId: workspaceId || null,
    });

    await writeCapabilityAuditEvent({
      orgId: access.orgId,
      userId: access.userId,
      workspaceId: workspaceId,
      action: "PROVIDER_STATUS_VIEWED",
      resourceType: "governance",
      result: "ok",
      metadata: { section: "overview" },
    });

    return NextResponse.json(projection);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
