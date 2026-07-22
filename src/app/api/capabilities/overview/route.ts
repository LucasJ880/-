/**
 * GET /api/capabilities/overview
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { getCapabilitiesOverview } from "@/lib/capabilities/overview/get-overview";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const overview = await getCapabilitiesOverview(access);
    return NextResponse.json(overview);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
