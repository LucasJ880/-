import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { approveAnalysisRun } from "@/lib/tender-auto-analysis/review";
import { maybeAutoDraftRfq } from "@/lib/tender-rfq/auto-draft-service";

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

  // RFQ-AUTO-2：要求都审完了就替人起草第 1 轮询价的待批卡（开关关闭 → null，响应里不带这个字段；重复批准不触发）
  const rfqAutoDraft = result.idempotent
    ? null
    : await maybeAutoDraftRfq({ orgId, projectId, runId: result.runId, userId: access.user.id, trigger: "approve_run" });

  return NextResponse.json({
    ok: true,
    runId: result.runId,
    status: result.status,
    statusLabel: "已批准",
    confirmedRequirementCount: result.confirmedRequirementCount,
    leftAiExtractedCount: result.leftAiExtractedCount,
    goDecisionUntouched: true,
    ...(rfqAutoDraft ? { rfqAutoDraft } : {}),
  });
}
