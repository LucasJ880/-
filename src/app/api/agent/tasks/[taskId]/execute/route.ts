import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { executeFlowTask, resumeFlowAfterApproval } from "@/lib/agent-core/skills/flow-runner";

/**
 * POST /api/agent/tasks/:taskId/execute
 * 开始或继续执行任务
 *
 * 安全（Security P0）：执行会触发真实副作用，必须重新校验当前 principal
 * 对该任务所属项目的管理权限——client UI 不是授权边界，直接打 API 亦被拦截。
 */
export const POST = withAuth(async (request, ctx) => {
  const { taskId } = await ctx.params;

  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const access = await requireProjectManageAccess(request, task.projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const isResume = (body as { resume?: boolean }).resume === true;

  const result = isResume
    ? await resumeFlowAfterApproval(taskId)
    : await executeFlowTask(taskId);

  return NextResponse.json(result);
});
