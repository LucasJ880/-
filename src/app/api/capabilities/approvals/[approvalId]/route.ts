/**
 * GET /api/capabilities/approvals/[approvalId]
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getCapabilityApproval } from "@/lib/capabilities/approvals/query";
import { logAudit } from "@/lib/audit/logger";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ approvalId: string }> },
) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { approvalId } = await ctx.params;
    const detail = await getCapabilityApproval(
      access,
      decodeURIComponent(approvalId),
    );

    if (detail.payloadSummary != null) {
      await logAudit({
        userId: access.userId,
        orgId: access.orgId,
        action: "APPROVAL_VIEWED_SENSITIVE",
        targetType: "approval",
        targetId: detail.id,
        afterData: { sourceType: detail.sourceType, visibility: "summary" },
      });
    }

    return NextResponse.json(detail);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
