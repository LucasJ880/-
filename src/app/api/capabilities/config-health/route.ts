/**
 * GET /api/capabilities/config-health
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { assessConfigHealth } from "@/lib/capabilities/config-health/assess";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const report = await assessConfigHealth(access);
    return NextResponse.json(report);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
