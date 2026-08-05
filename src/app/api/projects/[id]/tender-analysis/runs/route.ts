import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisRead,
} from "@/lib/tender-auto-analysis/api-access";
import { serializeRunListItem } from "@/lib/tender-auto-analysis/serializers";

/**
 * GET /api/projects/[id]/tender-analysis/runs
 * ?latest=1 → 仅最新一条（含页进度）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireTenderAnalysisRead(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const latest = request.nextUrl.searchParams.get("latest") === "1";

  const runs = await db.tenderAnalysisRun.findMany({
    where: { projectId, orgId },
    orderBy: { createdAt: "desc" },
    take: latest ? 1 : 50,
    select: {
      id: true,
      status: true,
      runKind: true,
      workerStep: true,
      summaryText: true,
      createdAt: true,
      completedAt: true,
      approvedAt: true,
      parentRunId: true,
      errorMessageSanitized: true,
      documents: {
        select: {
          document: {
            select: {
              pageCount: true,
              pages: { select: { id: true, parseStatus: true } },
            },
          },
        },
      },
      _count: {
        select: {
          changeCandidates: {
            where: { status: "PENDING_REVIEW" },
          },
        },
      },
    },
  });

  const items = runs.map((run) => {
    let pagesTotal = 0;
    let pagesDone = 0;
    for (const d of run.documents) {
      const pc = d.document.pageCount ?? d.document.pages.length;
      pagesTotal += pc;
      pagesDone += d.document.pages.filter((p) => p.parseStatus === "done").length;
    }
    return serializeRunListItem({
      ...run,
      pagesDone,
      pagesTotal: pagesTotal || null,
      pendingChangeCount: run._count.changeCandidates,
    });
  });

  if (latest) {
    return NextResponse.json({ run: items[0] ?? null });
  }
  return NextResponse.json({ runs: items });
}
