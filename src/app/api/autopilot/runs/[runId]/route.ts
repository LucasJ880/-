import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAutopilotAccess } from "@/lib/autopilot/access";
import { getAutopilotRun } from "@/lib/autopilot/service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const access = await requireAutopilotAccess(request, "autopilot.runs.read");
  if (access instanceof NextResponse) return access;

  const { runId } = await context.params;
  const detail = await getAutopilotRun(
    { id: access.userId, role: access.role },
    access.orgId,
    runId,
  );
  if (!detail) {
    return NextResponse.json(
      { error: "Not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json(detail);
}
