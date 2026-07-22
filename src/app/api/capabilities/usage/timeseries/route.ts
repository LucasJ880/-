/**
 * GET /api/capabilities/usage/timeseries
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  parseDateParam,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getUsageTimeseries } from "@/lib/capabilities/usage/query";

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
    const series = await getUsageTimeseries(access, { from, to });
    return NextResponse.json({
      orgId: access.orgId,
      currency: "USD",
      points: series,
    });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
