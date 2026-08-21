import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

/** 投标文件起草元信息（最近一次起草的占位/待确认计数与内部注）；生成走 generate-pdf docType=bid_draft */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
  const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } });
  const rsj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const matrix = (((run?.summaryJson as Record<string, unknown>) ?? {}).bidFitMatrix ?? {}) as Record<string, unknown>;
  const reqCount = run
    ? await db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id } })
    : 0;
  const latestDoc = await db.projectGeneratedDocument.findFirst({
    where: { projectId, docType: "bid_draft" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, version: true },
  }).catch(() => null);
  return NextResponse.json({
    runId: run?.id ?? null,
    requirementCount: reqCount,
    markedCount: Object.keys(matrix).length,
    draft: rsj.bidDraft ?? null,
    latestDoc,
  });
}
