/**
 * GET /api/capabilities/runs/[runId]
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getCapabilityRunDetail } from "@/lib/capabilities/runs/detail";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { runId } = await ctx.params;
    const traceId = request.nextUrl.searchParams.get("traceId");
    const detail = await getCapabilityRunDetail(access, runId, {
      traceId,
    });
    return NextResponse.json(detail);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
