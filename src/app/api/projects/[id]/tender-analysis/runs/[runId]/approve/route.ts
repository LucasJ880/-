import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { approveAnalysisRun } from "@/lib/tender-auto-analysis/review";

/**
 * POST — REVIEW_REQUIRED → APPROVED（需项目写权限）
 * body: { confirmAllRequirements?: boolean } 默认 false
 * NEVER 设置 GO 决策
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: projectId, runId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  let confirmAllRequirements = false;
  try {
    const body = await request.json();
    confirmAllRequirements = Boolean(body?.confirmAllRequirements);
  } catch {
    // 空 body 合法
  }

  const result = await approveAnalysisRun({
    runId,
    projectId,
    orgId,
    actorUserId: access.user.id,
    confirmAllRequirements,
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
    runId: result.runId,
    status: result.status,
    statusLabel: "已批准",
    confirmedRequirementCount: result.confirmedRequirementCount,
    leftAiExtractedCount: result.leftAiExtractedCount,
    goDecisionUntouched: true,
  });
}
