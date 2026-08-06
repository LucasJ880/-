import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { confirmRequirement } from "@/lib/tender-auto-analysis/review";

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

  const result = await confirmRequirement({
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
  return NextResponse.json({ ok: true, reviewStatusLabel: "已确认" });
}
