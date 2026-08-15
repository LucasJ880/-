import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import {
  enqueueTenderPackageAnalysis,
  enqueueTenderPackageIfReady,
  reanalyzeTenderPackage,
} from "@/lib/tender-auto-analysis/enqueue-package";
import {
  normalizeEnqueueResult,
  normalizeReanalyzeResult,
} from "@/lib/tender-auto-analysis/enqueue-outcome";

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

  let action: "enqueue" | "reanalyze" | "auto" = "enqueue";
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    if (body.action === "reanalyze") action = "reanalyze";
    else if (body.action === "auto") action = "auto";
  } catch {
    /* empty body ok */
  }

  // Phase D：后台自动触发（Package Ready 门 + 幂等）。最佳努力语义：
  // 未启用 / 未就绪均不是错误，一律 200，真实状态交由前端轮询 run 呈现。
  if (action === "auto") {
    const result = await enqueueTenderPackageIfReady({
      projectId,
      userId: access.user.id,
      orgId,
      trigger: "api_auto",
    });
    const outcome = normalizeEnqueueResult(result);
    return NextResponse.json(
      {
        ok: outcome.ok,
        code: outcome.code,
        enqueued: outcome.enqueued ?? false,
        runId: outcome.runId,
        status: outcome.status,
        reason: outcome.reason,
        documentCount: outcome.documentCount,
      },
      { status: 200 },
    );
  }

  if (action === "reanalyze") {
    const result = await reanalyzeTenderPackage({
      projectId,
      orgId,
      actorUserId: access.user.id,
    });
    const outcome = normalizeReanalyzeResult(result);
    return NextResponse.json(
      {
        ok: outcome.ok,
        code: outcome.code,
        error: outcome.ok ? undefined : outcome.message,
        message: outcome.message,
        reason: outcome.reason,
        suggestion: outcome.suggestion,
        runId: outcome.runId,
        status: outcome.status,
        documentCount: outcome.documentCount,
        packageFingerprint: outcome.packageFingerprint,
      },
      { status: outcome.httpStatus },
    );
  }

  const result = await enqueueTenderPackageAnalysis({
    projectId,
    userId: access.user.id,
    orgId,
  });
  const outcome = normalizeEnqueueResult(result);

  // 业务失败一律映射为非 200 HTTP，前端凭 res.ok + json.ok 即可判定，
  // 不再出现 "HTTP 200 + ok:false" 的静默失败。
  return NextResponse.json(
    {
      ok: outcome.ok,
      code: outcome.code,
      // 失败时提供 error（人类可读）；成功时省略以兼容旧字段语义。
      error: outcome.ok ? undefined : outcome.message,
      message: outcome.message,
      enqueued: outcome.enqueued,
      runId: outcome.runId,
      status: outcome.status,
      reason: outcome.reason,
      documentCount: outcome.documentCount,
      packageFingerprint: outcome.packageFingerprint,
      classificationWarning: outcome.classificationWarning ?? null,
      suggestion: outcome.suggestion,
    },
    { status: outcome.httpStatus },
  );
}
