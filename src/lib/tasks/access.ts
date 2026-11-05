/**
 * 任务查看规则（COLLAB-2，design D5）
 *
 * canAccessTask 从 src/app/api/tasks/[id]/route.ts 原样移来，行为不变。
 * 任务详情、任务评论、评论里的 @ 校验与 @ 候选人共用这一条规则。
 */

import { getVisibleProjectIds } from "@/lib/projects/visibility";

export interface TaskAccessFields {
  projectId: string | null;
  creatorId: string | null;
  assigneeId: string | null;
}

export function canAccessTask(
  task: TaskAccessFields,
  userId: string,
  visibleIds: string[] | null,
): boolean {
  if (visibleIds === null) return true;
  if (task.creatorId === userId || task.assigneeId === userId) return true;
  if (task.projectId && visibleIds.includes(task.projectId)) return true;
  if (!task.projectId) {
    return task.creatorId === userId || task.assigneeId === userId;
  }
  return false;
}

/** 某人能否查看该任务详情（按其平台角色取可见项目） */
export async function canUserViewTask(
  user: { id: string; role: string },
  task: TaskAccessFields,
): Promise<boolean> {
  // 创建人与负责人不论可见项目都能看（与 canAccessTask 相同），省一次查询
  if (task.creatorId === user.id || task.assigneeId === user.id) return true;
  return canAccessTask(task, user.id, await getVisibleProjectIds(user.id, user.role));
}
