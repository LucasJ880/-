import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { applyChangeCandidate } from "@/lib/tender-auto-analysis/addendum-diff";

/** POST — 标记 APPLIED；不自动改写已批准要求 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; runId: string; candidateId: string }>;
  },
) {
  const { id: projectId, runId, candidateId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const result = await applyChangeCandidate({
    runId,
    candidateId,
    projectId,
    orgId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.code === "not_found" ? 404 : 422 },
    );
  }
  return NextResponse.json({
    ok: true,
    statusLabel: "已接受",
    mutatedApprovedRequirements: false,
  });
}
