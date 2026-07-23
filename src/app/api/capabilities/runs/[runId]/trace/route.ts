/**
 * GET /api/capabilities/runs/[runId]/trace
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getCapabilityRunDetail } from "@/lib/capabilities/runs/detail";
import { requirePlatformAdmin } from "@/lib/auth/guards";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const admin = await requirePlatformAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { runId } = await ctx.params;
    const traceId = request.nextUrl.searchParams.get("traceId");
    const detail = await getCapabilityRunDetail(access, runId, { traceId });
    return NextResponse.json({
      orgId: detail.orgId,
      visibility: detail.visibility,
      basic: detail.basic,
      timeline: detail.timeline,
      modelCalls: detail.modelCalls,
      aggregate: detail.aggregate,
    });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
