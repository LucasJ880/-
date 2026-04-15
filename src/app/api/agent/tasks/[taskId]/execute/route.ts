import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { executeTask, resumeAfterApproval } from "@/lib/agent/executor";

/**
 * POST /api/agent/tasks/:taskId/execute
 * 开始或继续执行任务
 */
export const POST = withAuth(async (request, ctx) => {
  const { taskId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const isResume = (body as { resume?: boolean }).resume === true;

  const result = isResume
    ? await resumeAfterApproval(taskId)
    : await executeTask(taskId);

  return NextResponse.json(result);
});
