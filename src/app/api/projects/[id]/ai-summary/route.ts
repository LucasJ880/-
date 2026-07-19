import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { refreshStructuredSummary } from "@/lib/projects/structured-summary";
import { AI_ADVICE_LABELS } from "@/lib/projects/ai-summary-types";

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  let intel = await db.projectIntelligence.findUnique({
    where: { projectId },
    select: {
      structuredSummaryJson: true,
      summary: true,
      recommendation: true,
      riskLevel: true,
      fitScore: true,
    },
  });

  if (!intel?.structuredSummaryJson && intel) {
    await refreshStructuredSummary(projectId);
    intel = await db.projectIntelligence.findUnique({
      where: { projectId },
      select: {
        structuredSummaryJson: true,
        summary: true,
        recommendation: true,
        riskLevel: true,
        fitScore: true,
      },
    });
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      aiAdviceStatus: true,
      projectTypes: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      _count: { select: { similaritiesAsSource: true } },
    },
  });

  let structured = null;
  if (intel?.structuredSummaryJson) {
    try {
      structured = JSON.parse(intel.structuredSummaryJson);
    } catch {
      structured = null;
    }
  }

  return NextResponse.json({
    structured,
    summary: intel?.summary ?? null,
    recommendation: intel?.recommendation ?? null,
    riskLevel: intel?.riskLevel ?? null,
    fitScore: intel?.fitScore ?? null,
    aiAdviceStatus: project?.aiAdviceStatus ?? structured?.aiAdviceStatus ?? null,
    aiAdviceLabel:
      AI_ADVICE_LABELS[
        (project?.aiAdviceStatus ||
          structured?.aiAdviceStatus) as keyof typeof AI_ADVICE_LABELS
      ] ?? null,
    projectTypes: project?.projectTypes ?? structured?.projectTypes ?? [],
    similarCount: project?._count.similaritiesAsSource ?? 0,
    ourBidPrice: project?.ourBidPrice ?? null,
    winningBidPrice: project?.winningBidPrice ?? null,
    currency: project?.currency ?? null,
  });
});

export const POST = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const structured = await refreshStructuredSummary(projectId);
  if (!structured) {
    return NextResponse.json(
      { error: "请先生成项目情报分析" },
      { status: 400 },
    );
  }
  return NextResponse.json({ structured });
});
