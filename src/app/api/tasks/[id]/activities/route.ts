import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;
  const activities = await db.taskActivity.findMany({
    where: { taskId: id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(activities);
});
