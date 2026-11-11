import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { logAudit } from "@/lib/audit/logger";
import { BATCH_CONFIRM_AUDIT_ACTION, BATCH_CONFIRM_LIMIT } from "@/lib/tender-auto-analysis/requirement-batch-confirm";
import { batchConfirmRequirements } from "@/lib/tender-auto-analysis/review";
import { maybeAutoDraftRfq } from "@/lib/tender-rfq/auto-draft-service";

/**
 * POST body: { requirementIds: string[], onlyWhileInReview?: boolean }
 * onlyWhileInReview（RFQ-AUTO-4，可选）：为 true 时只在分析仍是等待审核时确认，否则 409 且一条都不确认。
 * 不带这个字段时行为与以前相同。
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

  let requirementIds: string[] = [];
  let onlyWhileInReview = false;
  try {
    const body = await request.json();
    onlyWhileInReview = body?.onlyWhileInReview === true;
    requirementIds = Array.isArray(body?.requirementIds)
      ? body.requirementIds.filter((x: unknown) => typeof x === "string")
      : [];
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const result = await batchConfirmRequirements({
    runId,
    projectId,
    orgId,
    requirementIds,
    ...(onlyWhileInReview ? { onlyWhileInReview: true } : {}),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.code === "not_found" ? 404 : result.code === "run_not_in_review" ? 409 : 400 },
    );
  }
  // RFQ-AUTO-4：留一条审计——谁、哪份分析、请求确认哪几条、实际确认了几条。
  // 确认已经完成，所以用吞错的写法：审计写不进去不让这次请求报错。
  await logAudit({
    userId: access.user.id,
    orgId,
    projectId,
    action: BATCH_CONFIRM_AUDIT_ACTION,
    targetType: "tender_analysis_run",
    targetId: runId,
    afterData: {
      // 与服务函数同一个上限：超出的部分没有被处理，也就不记。要求号是短字符串，过长的不可能对得上，不写进审计
      requestedRequirementIds: requirementIds.filter((id) => id.length > 0 && id.length <= 64).slice(0, BATCH_CONFIRM_LIMIT),
      requestedCount: requirementIds.filter(Boolean).length,
      confirmedCount: result.confirmedCount,
      onlyWhileInReview,
    },
    request,
  });

  // RFQ-AUTO-2：这一批确认完如果要求都审完了，替人起草第 1 轮询价的待批卡
  const rfqAutoDraft = await maybeAutoDraftRfq({ orgId, projectId, runId, userId: access.user.id, trigger: "batch_confirm" });
  return NextResponse.json({
    ok: true,
    confirmedCount: result.confirmedCount,
    ...(rfqAutoDraft ? { rfqAutoDraft } : {}),
  });
}
