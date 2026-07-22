/**
 * GET /api/capabilities/runs
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  parseDateParam,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { listCapabilityRuns } from "@/lib/capabilities/runs/list";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const sp = request.nextUrl.searchParams;
    // orgId 查询参数不可信：忽略
    const to = parseDateParam(sp.get("to"), new Date());
    const from = parseDateParam(
      sp.get("from"),
      new Date(to.getTime() - 30 * 86400000),
    );

    const result = await listCapabilityRuns(access, {
      from,
      to,
      workspaceId: sp.get("workspaceId") ?? undefined,
      projectId: sp.get("projectId") ?? undefined,
      status: sp.get("status") ?? undefined,
      executionType: sp.get("executionType") ?? undefined,
      agent: sp.get("agent") ?? undefined,
      skill: sp.get("skill") ?? undefined,
      tool: sp.get("tool") ?? undefined,
      userId: sp.get("userId") ?? undefined,
      model: sp.get("model") ?? undefined,
      hasError:
        sp.get("hasError") === "true"
          ? true
          : sp.get("hasError") === "false"
            ? false
            : undefined,
      waitingApproval:
        sp.get("waitingApproval") === "true" ? true : undefined,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
    });

    return NextResponse.json({
      ...result,
      orgId: access.orgId,
    });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
