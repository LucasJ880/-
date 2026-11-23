/**
 * POST — 创建 AI 投标方案任务（持久化到 AgentTask），立即返回 taskId
 * GET  — 查询任务完整状态 + 所有步骤结果
 *
 * 权限（FIX-21）：POST 要项目写权限，GET 要项目读权限，都是处理函数的第一步。
 * GET 对不是平台管理员的调用者只给安全视图（与 /api/agent/tasks 同一约定，src/lib/agent-tasks/dto.ts 头注释）：
 * 每一步的 data 为空对象，失败或带报错的步骤 error 换成固定提示；平台管理员照旧拿到原始输出与原始报错。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { createBidPackageTask } from "@/lib/agent-core/skills/bid-package";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";

/**
 * 与 src/lib/agent-tasks/dto.ts 的 SAFE_STEP_ERROR_MESSAGE 一字不差。src/lib/agent-tasks 是 runtime-architecture
 * 冻结面，新文件不能导入它（scripts/test-runtime-architecture.sh 的 NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN），
 * 所以在这里照抄；两处一致由 src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts 断言。
 */
const SAFE_STEP_ERROR_MESSAGE = "处理失败，请稍后重试或联系管理员";

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const plan = await createBidPackageTask({
    projectId,
    userId: user.id,
  });

  return NextResponse.json({
    taskId: plan.taskId,
    taskType: plan.taskType,
    steps: plan.steps,
    source: plan.source,
  });
});

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  // 平台管理员保留完整诊断视图；其余人（含以岗位预览身份访问的 super_admin）只拿安全视图
  const diagnostic = isPlatformAdmin(access.user);

  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");

  let resolvedTaskId = taskId;
  if (!resolvedTaskId) {
    const latest = await db.agentTask.findFirst({
      where: { projectId, taskType: "ai_bid_package" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      return NextResponse.json({ taskId: null, steps: [] });
    }
    resolvedTaskId = latest.id;
  }

  const task = await db.agentTask.findUnique({
    where: { id: resolvedTaskId, projectId },
    select: {
      id: true,
      status: true,
      taskType: true,
      totalSteps: true,
      currentStepIndex: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      steps: {
        orderBy: { stepIndex: "asc" },
        select: {
          id: true,
          stepIndex: true,
          skillId: true,
          title: true,
          status: true,
          outputJson: true,
          outputSummary: true,
          error: true,
          startedAt: true,
          completedAt: true,
          inputJson: true,
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const steps = task.steps.map((s) => {
    let data: Record<string, unknown> = {};
    if (diagnostic && s.outputJson) {
      try { data = JSON.parse(s.outputJson); } catch { /* skip */ }
    }
    let action: string | undefined;
    if (s.inputJson) {
      try {
        const mapping = JSON.parse(s.inputJson);
        const raw = mapping.action as string | undefined;
        if (raw) action = raw.replace(/^'|'$/g, "");
      } catch { /* skip */ }
    }

    return {
      id: s.id,
      stepIndex: s.stepIndex,
      skillId: s.skillId,
      title: s.title,
      action,
      status: s.status,
      success: s.status === "completed",
      summary: s.outputSummary ?? "",
      data,
      // 与 dto.ts 的 sanitizeListStepError 同一口径：失败或带报错给固定提示，否则 null；平台管理员给原文
      error: diagnostic
        ? s.error
        : s.status === "error" || s.status === "failed" || s.error
          ? SAFE_STEP_ERROR_MESSAGE
          : null,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      durationMs:
        s.startedAt && s.completedAt
          ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()
          : null,
    };
  });

  const completedSteps = steps.filter((s) => s.success).length;

  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    taskType: task.taskType,
    totalSteps: task.totalSteps,
    completedSteps,
    success: task.status === "completed",
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    steps,
  });
});
