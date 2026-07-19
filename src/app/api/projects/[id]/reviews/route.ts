import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  confirmProjectReview,
  maybeCreateReviewDraft,
} from "@/lib/projects/review";

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  await maybeCreateReviewDraft(projectId).catch(() => null);

  const reviews = await db.projectReview.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return NextResponse.json({ reviews });
});

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  if (body.action === "create_draft") {
    const draft = await maybeCreateReviewDraft(projectId);
    return NextResponse.json({ review: draft });
  }
  if (body.action === "confirm" && typeof body.reviewId === "string") {
    const review = await confirmProjectReview({
      reviewId: body.reviewId,
      userId: user.id,
      patch: {
        outcome: body.outcome,
        reasonTags: body.reasonTags,
        narrative: body.narrative,
        customerFeedback: body.customerFeedback,
        ourBidPrice: body.ourBidPrice,
        winningBidPrice: body.winningBidPrice,
      },
    });
    return NextResponse.json({ review });
  }
  return NextResponse.json({ error: "action 无效" }, { status: 400 });
});
