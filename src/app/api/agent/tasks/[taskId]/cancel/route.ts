import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { cancelFlowTask } from "@/lib/agent-core/skills/flow-runner";

/**
 * POST /api/agent/tasks/:taskId/cancel
 */
export const POST = withAuth(async (_request, ctx) => {
  const { taskId } = await ctx.params;
  await cancelFlowTask(taskId);
  return NextResponse.json({ success: true, status: "cancelled" });
});
