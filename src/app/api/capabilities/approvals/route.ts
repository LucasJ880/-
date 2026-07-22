/**
 * GET /api/capabilities/approvals
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  parseDateParam,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { listCapabilityApprovals } from "@/lib/capabilities/approvals/query";
import type { ApprovalSourceType } from "@/lib/capabilities/approvals/types";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const sp = request.nextUrl.searchParams;
    const to = parseDateParam(sp.get("to"), new Date());
    const from = parseDateParam(
      sp.get("from"),
      new Date(to.getTime() - 30 * 86400000),
    );
    const sourceType = sp.get("sourceType") as ApprovalSourceType | null;

    const result = await listCapabilityApprovals(access, {
      from,
      to,
      workspaceId: sp.get("workspaceId") ?? undefined,
      projectId: sp.get("projectId") ?? undefined,
      sourceType: sourceType ?? undefined,
      actionType: sp.get("actionType") ?? undefined,
      riskLevel: sp.get("riskLevel") ?? undefined,
      status: sp.get("status") ?? undefined,
      executionStatus: sp.get("executionStatus") ?? undefined,
      submittedById: sp.get("submittedById") ?? undefined,
      tab: sp.get("tab") ?? "pending_mine",
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
    });

    return NextResponse.json({ ...result, orgId: access.orgId });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
