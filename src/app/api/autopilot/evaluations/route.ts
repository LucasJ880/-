import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAutopilotAccess } from "@/lib/autopilot/access";
import { parseEvaluateListQuery } from "@/lib/autopilot/evaluate-query";
import { getAutopilotEvaluations } from "@/lib/autopilot/service";
import { ObserveQueryError } from "@/lib/autopilot/observe-range";

export async function GET(request: NextRequest) {
  const access = await requireAutopilotAccess(request, "autopilot.view");
  if (access instanceof NextResponse) return access;

  try {
    const query = parseEvaluateListQuery(request.nextUrl.searchParams);
    const result = await getAutopilotEvaluations(
      { id: access.userId, role: access.role },
      access.orgId,
      query,
    );
    return NextResponse.json(result);
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
