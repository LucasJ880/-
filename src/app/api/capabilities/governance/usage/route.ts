/**
 * GET /api/capabilities/governance/usage
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import {
  assertCanReadGovernance,
  getGovernanceUsage,
} from "@/lib/capabilities/governance";
import { isOrgAdminRole } from "@/lib/capabilities/access";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    await assertCanReadGovernance(access);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");

    if (
      workspaceId &&
      !access.workspaceIds.includes(workspaceId) &&
      !isOrgAdminRole(access.orgRole)
    ) {
      return NextResponse.json(
        { error: "无权查看该 Workspace", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    // 非 org_admin：强制限定本 WS 汇总
    const scopeWs =
      workspaceId ||
      (!isOrgAdminRole(access.orgRole)
        ? access.workspaceIds[0] ?? null
        : null);

    const usage = await getGovernanceUsage({
      access,
      workspaceId: scopeWs,
    });

    return NextResponse.json(usage);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
