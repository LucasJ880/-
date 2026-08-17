import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAutopilotAccess } from "@/lib/autopilot/access";
import { getAutopilotOverview } from "@/lib/autopilot/service";
import {
  ObserveQueryError,
  parseObserveRange,
} from "@/lib/autopilot/observe-range";

export async function GET(request: NextRequest) {
  const access = await requireAutopilotAccess(request, "autopilot.view");
  if (access instanceof NextResponse) return access;

  try {
    const range = parseObserveRange(request.nextUrl.searchParams.get("range"));
    const overview = await getAutopilotOverview(
      { id: access.userId, role: access.role },
      access.orgId,
      { range },
    );
    return NextResponse.json(overview);
  } catch (error) {
    if (error instanceof ObserveQueryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }
    throw error;
  }
}
