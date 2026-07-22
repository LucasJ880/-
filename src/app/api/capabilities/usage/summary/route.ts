/**
 * GET /api/capabilities/usage/summary
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  parseDateParam,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getUsageSummary } from "@/lib/capabilities/usage/query";

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
    const summary = await getUsageSummary(access, { from, to });
    return NextResponse.json(summary);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
