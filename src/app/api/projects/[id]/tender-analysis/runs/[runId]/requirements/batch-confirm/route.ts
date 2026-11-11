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

/** POST body: { requirementIds: string[] } */
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
  try {
    const body = await request.json();
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
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.code === "not_found" ? 404 : 400 },
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
      // 与服务函数同一个上限：超出的部分没有被处理，也就不记
      requestedRequirementIds: requirementIds.filter(Boolean).slice(0, BATCH_CONFIRM_LIMIT),
      requestedCount: requirementIds.filter(Boolean).length,
      confirmedCount: result.confirmedCount,
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
