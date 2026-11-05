import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { canUserViewTask } from "@/lib/tasks/access";
import { listTaskMentionCandidates } from "@/lib/notifications/collab/mentions";

/**
 * GET /api/tasks/[id]/mention-candidates
 * 任务评论 @ 的候选人（COLLAB-2，design D5）：只对能查看该任务详情的人开放，否则 404。
 * 返回 { members: [{ userId, name, avatar }] }，不含调用人，按姓名排序，最多 200 人。
 */
export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const task = await db.task.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      project: { select: { orgId: true } },
    },
  });
  if (!task || !(await canUserViewTask(user, task))) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const members = await listTaskMentionCandidates(
    { ...task, orgId: task.project?.orgId ?? null },
    user.id,
  );
  return NextResponse.json({ members });
});
