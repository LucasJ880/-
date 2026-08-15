import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAutopilotAccess } from "@/lib/autopilot/access";
import { listAutopilotRuns } from "@/lib/autopilot/service";

export async function GET(request: NextRequest) {
  const access = await requireAutopilotAccess(request, "autopilot.runs.read");
  if (access instanceof NextResponse) return access;

  const sp = request.nextUrl.searchParams;
  const result = await listAutopilotRuns(
    { id: access.userId, role: access.role },
    access.orgId,
    {
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 50,
    },
  );
  return NextResponse.json(result);
}
