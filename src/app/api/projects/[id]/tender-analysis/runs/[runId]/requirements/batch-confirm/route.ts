import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { batchConfirmRequirements } from "@/lib/tender-auto-analysis/review";

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
  return NextResponse.json({
    ok: true,
    confirmedCount: result.confirmedCount,
  });
}
