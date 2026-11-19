import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { rejectRequirement } from "@/lib/tender-auto-analysis/review";
import { maybeAutoDraftRfq } from "@/lib/tender-rfq/auto-draft-service";
import { maybeAutoSupplierRun } from "@/lib/tender-intel/auto-supplier-run";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; runId: string; requirementId: string }>;
  },
) {
  const { id: projectId, runId, requirementId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const result = await rejectRequirement({
    runId,
    requirementId,
    projectId,
    orgId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.code === "not_found" ? 404 : 400 },
    );
  }
  // RFQ-AUTO-2：这是最后一条未审核的要求时，替人起草第 1 轮询价的待批卡
  // CHAIN-2：分析已批准且还没有候选池时先建（开关关闭 → 立即返回；出错只记日志）
  await maybeAutoSupplierRun({ orgId, projectId, runId, userId: access.user.id });
  const rfqAutoDraft = await maybeAutoDraftRfq({ orgId, projectId, runId, userId: access.user.id, trigger: "reject_requirement" });
  return NextResponse.json({ ok: true, reviewStatusLabel: "已驳回", ...(rfqAutoDraft ? { rfqAutoDraft } : {}) });
}
