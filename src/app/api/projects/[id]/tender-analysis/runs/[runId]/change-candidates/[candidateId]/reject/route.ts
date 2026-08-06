import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { rejectChangeCandidate } from "@/lib/tender-auto-analysis/addendum-diff";

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

  const result = await rejectChangeCandidate({
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
  return NextResponse.json({ ok: true, statusLabel: "已忽略" });
}
