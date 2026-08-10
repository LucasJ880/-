import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { runGuardedTaskMutation } from "@/lib/agent-tasks/guarded-mutation";
import { cancelFlowTask } from "@/lib/agent-core/skills/flow-runner";

/**
 * POST /api/agent/tasks/:taskId/cancel
 *
 * 安全（Security P0）：取消是状态变更，必须重新校验当前 principal
 * 对该任务所属项目的管理权限；仅凭 taskId 不足以取消。
 * 守卫链保证拒绝路径下 cancelFlowTask 不被调用（零副作用）。
 */
export const POST = withAuth(async (request, ctx) => {
  const { taskId } = await ctx.params;

  return runGuardedTaskMutation({
    request,
    taskId,
    loadTaskProjectId: (id) =>
      db.agentTask
        .findUnique({ where: { id }, select: { projectId: true } })
        .then((t) => t?.projectId ?? null),
    authorize: requireProjectManageAccess,
    onAuthorized: async () => {
      await cancelFlowTask(taskId);
      return NextResponse.json({ success: true, status: "cancelled" });
    },
  });
});
