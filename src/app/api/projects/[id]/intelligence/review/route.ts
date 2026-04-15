import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

const VALID_STATUSES = [
  "draft",
  "ai_generated",
  "in_review",
  "approved",
  "needs_revision",
  "delivered",
] as const;

type ReviewStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/projects/:id/intelligence/review
 *
 * 获取情报报告的审核状态及 report_meta。
 */
export const GET = withAuth(async (_request, ctx) => {
  const { id: projectId } = await ctx.params;

  const intel = await db.projectIntelligence.findUnique({
    where: { projectId },
    select: {
      id: true,
      reportStatus: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewNotes: true,
      reviewScore: true,
      recommendation: true,
      riskLevel: true,
      fitScore: true,
      fullReportJson: true,
      updatedAt: true,
    },
  });

  if (!intel) {
    return NextResponse.json({ error: "该项目尚无情报报告" }, { status: 404 });
  }

  let meta = null;
  if (intel.fullReportJson) {
    try {
      const parsed = JSON.parse(intel.fullReportJson);
      meta = parsed._meta ?? null;
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    reportStatus: intel.reportStatus,
    reviewedBy: intel.reviewedBy,
    reviewedAt: intel.reviewedAt,
    reviewNotes: intel.reviewNotes,
    reviewScore: intel.reviewScore,
    recommendation: intel.recommendation,
    riskLevel: intel.riskLevel,
    fitScore: intel.fitScore,
    meta,
    updatedAt: intel.updatedAt,
  });
});

/**
 * PATCH /api/projects/:id/intelligence/review
 *
 * 更新情报报告的审核状态。
 *
 * Body:
 *   reportStatus: "in_review" | "approved" | "needs_revision" | "delivered"
 *   reviewNotes?: string
 *   reviewScore?: number (1-5)
 */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const intel = await db.projectIntelligence.findUnique({
    where: { projectId },
    select: { id: true, reportStatus: true },
  });

  if (!intel) {
    return NextResponse.json({ error: "该项目尚无情报报告" }, { status: 404 });
  }

  const body = await request.json();
  const { reportStatus, reviewNotes, reviewScore } = body as {
    reportStatus?: string;
    reviewNotes?: string;
    reviewScore?: number;
  };

  if (reportStatus && !VALID_STATUSES.includes(reportStatus as ReviewStatus)) {
    return NextResponse.json(
      { error: `无效状态，允许: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  if (reviewScore !== undefined && (reviewScore < 1 || reviewScore > 5)) {
    return NextResponse.json(
      { error: "reviewScore 必须在 1-5 之间" },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};

  if (reportStatus) {
    data.reportStatus = reportStatus;
  }

  if (reviewNotes !== undefined) {
    data.reviewNotes = reviewNotes;
  }

  if (reviewScore !== undefined) {
    data.reviewScore = reviewScore;
  }

  if (
    reportStatus === "approved" ||
    reportStatus === "needs_revision" ||
    reportStatus === "delivered"
  ) {
    data.reviewedBy = user.name || user.email || user.id;
    data.reviewedAt = new Date();
  }

  const updated = await db.projectIntelligence.update({
    where: { projectId },
    data,
    select: {
      reportStatus: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewNotes: true,
      reviewScore: true,
    },
  });

  return NextResponse.json(updated);
});
