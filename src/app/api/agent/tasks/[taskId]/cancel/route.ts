import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { cancelTask } from "@/lib/agent/executor";

/**
 * POST /api/agent/tasks/:taskId/cancel
 */
export const POST = withAuth(async (_request, ctx) => {
  const { taskId } = await ctx.params;
  await cancelTask(taskId);
  return NextResponse.json({ success: true, status: "cancelled" });
});
