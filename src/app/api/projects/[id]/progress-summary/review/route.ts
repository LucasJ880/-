import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import {
  getLatestSummary,
  getSummaryHistory,
  updateSummaryReview,
} from "@/lib/progress/generate-summary";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/progress-summary/review
 *
 * 获取最新摘要的审核状态 + 历史列表
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const [latest, history] = await Promise.all([
    getLatestSummary(id),
    getSummaryHistory(id, 10),
  ]);

  return NextResponse.json({
    latest: latest
      ? {
          id: latest.id,
          overallStatus: latest.overallStatus,
          statusLabel: latest.statusLabel,
          executiveSummary: latest.executiveSummary,
          reportStatus: latest.reportStatus,
          reviewedBy: latest.reviewedBy,
          reviewedAt: latest.reviewedAt,
          reviewNotes: latest.reviewNotes,
          reviewScore: latest.reviewScore,
          promptVersion: latest.promptVersion,
          modelUsed: latest.modelUsed,
          usedFallback: latest.usedFallback,
          triggerType: latest.triggerType,
          createdAt: latest.createdAt,
        }
      : null,
    history,
  });
}

const VALID_STATUSES = ["ai_generated", "in_review", "approved", "needs_revision"];

/**
 * PATCH /api/projects/:id/progress-summary/review
 *
 * 更新摘要审核状态
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  const { summaryId, reportStatus, reviewNotes, reviewScore } = body;

  if (!summaryId || typeof summaryId !== "string") {
    return NextResponse.json({ error: "缺少 summaryId" }, { status: 400 });
  }

  if (!reportStatus || !VALID_STATUSES.includes(reportStatus)) {
    return NextResponse.json({ error: `reportStatus 必须是 ${VALID_STATUSES.join("/")}` }, { status: 400 });
  }

  if (reviewScore !== undefined && (typeof reviewScore !== "number" || reviewScore < 1 || reviewScore > 5)) {
    return NextResponse.json({ error: "reviewScore 必须为 1-5 整数" }, { status: 400 });
  }

  try {
    const updated = await updateSummaryReview(summaryId, {
      reportStatus,
      reviewedBy: access.user.name || access.user.email || access.user.id,
      reviewNotes,
      reviewScore,
    });

    return NextResponse.json({
      id: updated.id,
      reportStatus: updated.reportStatus,
      reviewedBy: updated.reviewedBy,
      reviewedAt: updated.reviewedAt,
      reviewNotes: updated.reviewNotes,
      reviewScore: updated.reviewScore,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "更新失败" },
      { status: 500 },
    );
  }
}
