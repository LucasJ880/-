import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { cancelFlowTask } from "@/lib/agent-core/skills/flow-runner";

/**
 * POST /api/agent/tasks/:taskId/cancel
 *
 * 安全（Security P0）：取消是状态变更，必须重新校验当前 principal
 * 对该任务所属项目的管理权限；仅凭 taskId 不足以取消。
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

  await cancelFlowTask(taskId);
  return NextResponse.json({ success: true, status: "cancelled" });
});
