import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import {
  toBusinessAgentTaskDetail,
  toDiagnosticAgentTaskDetail,
} from "@/lib/agent-tasks/dto";

/**
 * GET /api/agent/tasks/:taskId
 * 任务详情（含步骤 + 审批）
 *
 * 安全（Security P0）：
 * - 必须校验当前用户对任务所属项目的读权限（禁止跨 org 凭 taskId 直读）。
 * - 普通业务用户返回安全投影（无 inputJson / outputJson / checkReportJson /
 *   原始 error / previewJson）；平台管理员保留完整诊断视图。
 */
export const GET = withAuth(async (request, ctx) => {
  const { taskId } = await ctx.params;

  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, name: true } },
      steps: {
        orderBy: { stepIndex: "asc" },
        include: {
          approvalRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      approvalRequests: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  const access = await requireProjectReadAccess(request, task.projectId);
  if (access instanceof NextResponse) return access;

  const diagnostic = isPlatformAdmin(access.user);

  return NextResponse.json({
    task: diagnostic
      ? toDiagnosticAgentTaskDetail(task)
      : toBusinessAgentTaskDetail(task),
  });
});

/**
 * PATCH /api/agent/tasks/:taskId
 * 更新任务（目前仅支持 pause/resume）
 *
 * 安全（Security P0）：状态变更需项目管理权限。
 */
export const PATCH = withAuth(async (request, ctx) => {
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

  const body = await request.json();
  const { action } = body as { action: "pause" | "resume" };

  if (action === "pause") {
    await db.agentTask.update({
      where: { id: taskId },
      data: { status: "paused" },
    });
    return NextResponse.json({ success: true, status: "paused" });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
});
