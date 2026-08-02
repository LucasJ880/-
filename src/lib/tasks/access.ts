import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma, Task } from "@prisma/client";

// ============================================================
// 任务归属（个人工作区模型）
// 任务对创建者与被指派人可见；其他用户一律 404（不暴露存在性）
// ============================================================

/** 个人可见任务的 where 过滤 */
export function myTasksWhere(userId: string): Prisma.TaskWhereInput {
  return { OR: [{ creatorId: userId }, { assigneeId: userId }] };
}

/**
 * 任务归属校验
 *
 * @example
 * const access = await requireTaskAccess(request, id);
 * if (access instanceof NextResponse) return access;
 * const { user, task } = access;
 */
export async function requireTaskAccess(
  request: NextRequest,
  taskId: string
): Promise<{ user: AuthUser; task: Task } | NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || (task.creatorId !== user.id && task.assigneeId !== user.id)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  return { user, task };
}
