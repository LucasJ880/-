import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisRead,
} from "@/lib/tender-auto-analysis/api-access";
import { serializeChangeCandidate } from "@/lib/tender-auto-analysis/serializers";

/** GET — 列出变更候选 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: projectId, runId } = await params;
  const access = await requireTenderAnalysisRead(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const run = await db.tenderAnalysisRun.findFirst({
    where: { id: runId, projectId, orgId },
    select: { id: true, runKind: true },
  });
  if (!run) {
    return NextResponse.json({ error: "分析记录不存在" }, { status: 404 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const rows = await db.tenderAnalysisChangeCandidate.findMany({
    where: {
      runId: run.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    runKind: run.runKind,
    candidates: rows.map(serializeChangeCandidate),
    pendingCount: rows.filter((r) => r.status === "PENDING_REVIEW").length,
  });
}
