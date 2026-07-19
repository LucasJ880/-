import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId, insightId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const decision = body.decision;
  if (decision !== "confirm" && decision !== "reject") {
    return NextResponse.json({ error: "decision 无效" }, { status: 400 });
  }

  const insight = await db.projectInsight.findFirst({
    where: { id: insightId, projectId },
  });
  if (!insight) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }

  const updated = await db.projectInsight.update({
    where: { id: insight.id },
    data:
      decision === "confirm"
        ? {
            status: "confirmed",
            confirmedAt: new Date(),
            confirmedBy: user.id,
          }
        : { status: "rejected" },
  });
  return NextResponse.json({ insight: updated });
});
