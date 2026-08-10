/**
 * Tender/Project Security P0 — AgentTask mutation 授权编排。
 *
 * execute / cancel 等状态变更路由共用同一条守卫链：
 *   1) 载入任务的 projectId（不存在 → 404，且不派发动作）
 *   2) 重新校验当前 principal 对该项目的授权（拒绝 → 返回其 NextResponse，且不派发动作）
 *   3) 仅当授权通过，才执行 onAuthorized（真实副作用，如 executeFlowTask）
 *
 * 把顺序固化在一处，保证「拒绝路径零副作用」对所有此类路由一致成立，
 * 并可被 route-level 可执行测试直接驱动（注入计数依赖）验证调用次数。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** authorize 返回 NextResponse 表示拒绝；返回其它（access context）表示放行 */
export type TaskProjectAuthorize = (
  request: NextRequest,
  projectId: string,
) => Promise<unknown>;

export interface GuardedTaskMutationOptions {
  request: NextRequest;
  taskId: string;
  /** 载入任务所属 projectId；任务不存在返回 null */
  loadTaskProjectId: (taskId: string) => Promise<string | null>;
  /** 项目授权校验（拒绝时返回 NextResponse） */
  authorize: TaskProjectAuthorize;
  /** 授权通过后的动作（真实副作用在此） */
  onAuthorized: () => Promise<NextResponse>;
  /** 任务不存在时的响应（默认 404） */
  notFound?: () => NextResponse;
}

/**
 * 顺序：load → (404) → authorize → (denial) → onAuthorized。
 * onAuthorized 仅在授权通过时被调用一次；任何前置短路都不触碰它。
 */
export async function runGuardedTaskMutation(
  opts: GuardedTaskMutationOptions,
): Promise<NextResponse> {
  const {
    request,
    taskId,
    loadTaskProjectId,
    authorize,
    onAuthorized,
    notFound,
  } = opts;

  const projectId = await loadTaskProjectId(taskId);
  if (!projectId) {
    return notFound
      ? notFound()
      : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const access = await authorize(request, projectId);
  if (access instanceof NextResponse) {
    return access;
  }

  return onAuthorized();
}
