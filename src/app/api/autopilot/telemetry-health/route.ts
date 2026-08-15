import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAutopilotAccess } from "@/lib/autopilot/access";
import { getAutopilotTelemetryHealth } from "@/lib/autopilot/service";

export async function GET(request: NextRequest) {
  const access = await requireAutopilotAccess(request, "autopilot.view");
  if (access instanceof NextResponse) return access;

  const health = await getAutopilotTelemetryHealth(
    { id: access.userId, role: access.role },
    access.orgId,
  );
  return NextResponse.json(health);
}
