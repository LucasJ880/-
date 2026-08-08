import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import {
  enqueueTenderPackageAnalysis,
  reanalyzeTenderPackage,
} from "@/lib/tender-auto-analysis/enqueue-package";

/**
 * POST /api/projects/[id]/tender-analysis/package
 * body: { action?: "enqueue" | "reanalyze" }
 *
 * 对当前 Project 有效投标文件包入队 / 重新分析（无需重传 PDF）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  let action: "enqueue" | "reanalyze" = "enqueue";
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    if (body.action === "reanalyze") action = "reanalyze";
  } catch {
    /* empty body ok */
  }

  if (action === "reanalyze") {
    const result = await reanalyzeTenderPackage({
      projectId,
      orgId,
      actorUserId: access.user.id,
    });
    if (!result.ok) {
      const status =
        result.code === "rate_limited"
          ? 429
          : result.code === "active_run"
            ? 409
            : result.code === "PACKAGE_TOO_LARGE"
              ? 413
              : 400;
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status },
      );
    }
    return NextResponse.json({
      ok: true,
      runId: result.newRunId,
      documentCount: result.documentCount,
      packageFingerprint: result.packageFingerprint,
      status: result.status,
    });
  }

  const result = await enqueueTenderPackageAnalysis({
    projectId,
    userId: access.user.id,
    orgId,
  });

  if (!result.enqueued && result.reason === "PACKAGE_TOO_LARGE") {
    return NextResponse.json(
      {
        error: "投标文件包总页数超过上限",
        code: "PACKAGE_TOO_LARGE",
        documentCount: result.documentCount,
      },
      { status: 413 },
    );
  }

  return NextResponse.json({
    ok: result.enqueued || result.reason === "idempotent_reuse",
    enqueued: result.enqueued,
    runId: result.runId,
    status: result.status,
    reason: result.reason,
    documentCount: result.documentCount,
    packageFingerprint: result.packageFingerprint,
    classificationWarning: result.classificationWarning ?? null,
    suggestion: result.suggestion,
  });
}
