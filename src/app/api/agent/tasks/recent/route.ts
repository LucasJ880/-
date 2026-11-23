import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { RECENT_TASKS_LIMIT, parseListLimit, sanitizeListStepInternals } from "@/lib/agent-tasks/dto";
import { listEffectiveMemberships } from "@/lib/preview/server";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import { isOrgSystemAdmin, isSuperAdmin } from "@/lib/rbac/roles";
import { buildReadableProjectWhere, type SearchWhere } from "@/lib/search/where";

/**
 * 调用者现在仍能打开的项目（与项目读权限守卫 requireProjectReadAccess 同口径）：
 * 平台 super_admin 不加范围（含未分发项目）；其余人为已分发，且本人负责、本人在项目所属企业为 owner / admin、
 * 或本人是项目 active 成员。以岗位预览身份访问时 user.role 已降为 user，有效成员身份只有预览企业（org_member）。
 */
async function readableProjectScope(user: { id: string; role: string }): Promise<SearchWhere | null> {
  if (isSuperAdmin(user.role)) return null;
  const memberships = await listEffectiveMemberships(user.id);
  const adminOrgIds = memberships.filter((m) => isOrgSystemAdmin(m.role)).map((m) => m.orgId);
  return buildReadableProjectWhere(user.id, adminOrgIds);
}

/**
 * GET /api/agent/tasks/recent
 *
 * 获取当前用户最近的自动化任务（含 cron 触发的巡检任务）。
 * FIX-23（spec agents/agent-tasks-recent-view）：
 * - 只返回本人建的、而且现在仍能打开所属项目的任务；范围写进同一次查询，先筛后取最近 N 条；
 * - 不是平台管理员的人（含以岗位预览身份访问的 super_admin）每一步 checkReportJson 为 null（键保留）；
 * - 步骤不选原始 error / inputJson / outputJson（授权布线契约测试断言）。
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const triggerType = request.nextUrl.searchParams.get("triggerType");
  // limit 只认十进制正整数，否则按 10；再封顶 20
  const limit = parseListLimit(request.nextUrl.searchParams.get("limit"), RECENT_TASKS_LIMIT);
  const projectScope = await readableProjectScope(user);

  const tasks = await db.agentTask.findMany({
    where: {
      createdById: user.id,
      ...(triggerType ? { triggerType } : {}),
      ...(projectScope ? { project: projectScope } : {}),
    },
    select: {
      id: true,
      taskType: true,
      triggerType: true,
      intent: true,
      status: true,
      currentStepIndex: true,
      totalSteps: true,
      createdAt: true,
      completedAt: true,
      project: { select: { id: true, name: true } },
      steps: {
        select: {
          id: true,
          title: true,
          status: true,
          outputSummary: true,
          checkReportJson: true,
        },
        orderBy: { stepIndex: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const diagnostic = isPlatformAdmin(user);
  return NextResponse.json({
    tasks: tasks.map((task) => ({
      ...task,
      steps: task.steps.map((step) => sanitizeListStepInternals(step, diagnostic)),
    })),
  });
});
