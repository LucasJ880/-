import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { reanalyzeRun } from "@/lib/tender-auto-analysis/review";

/** POST — 创建新 PENDING run，克隆来源；非 APPROVED 旧跑标 SUPERSEDED */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: projectId, runId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const result = await reanalyzeRun({
    runId,
    projectId,
    orgId,
    actorUserId: access.user.id,
  });

  if (!result.ok) {
    const status =
      result.code === "not_found"
        ? 404
        : result.code === "invalid_status"
          ? 422
          : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    runId: result.newRunId,
    status: result.status,
    statusLabel: "等待分析",
    supersededRunId: result.supersededRunId,
  });
}
