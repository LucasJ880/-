/**
 * GET /api/capabilities/catalog
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { listCapabilityCatalog } from "@/lib/capabilities/catalog/list";
import type {
  CapabilitySourceScope,
  CapabilityStatus,
  CapabilityType,
} from "@/lib/capabilities/catalog/types";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const sp = request.nextUrl.searchParams;
    // orgId 查询参数不可信：忽略，仅用 TenantContext
    const requiresApprovalRaw = sp.get("requiresApproval");
    const recentlyRunRaw = sp.get("recentlyRun");

    const result = await listCapabilityCatalog(access, {
      type: (sp.get("type") as CapabilityType) || "",
      status: (sp.get("status") as CapabilityStatus) || "",
      workspaceId: sp.get("workspaceId") ?? undefined,
      sourceScope: (sp.get("sourceScope") as CapabilitySourceScope) || "",
      riskLevel: sp.get("riskLevel") ?? undefined,
      requiresApproval:
        requiresApprovalRaw === "true"
          ? true
          : requiresApprovalRaw === "false"
            ? false
            : undefined,
      recentlyRun: recentlyRunRaw === "true" ? true : undefined,
      q: sp.get("q") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
