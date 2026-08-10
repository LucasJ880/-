import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import { sanitizeListStepError } from "@/lib/agent-tasks/dto";
import { generateFlowPlan } from "@/lib/agent-core/skills/flow-runner";
import { listTemplates } from "@/lib/agent/templates";
import type { TriggerType } from "@/lib/agent/types";

/**
 * GET /api/agent/tasks?projectId=xxx
 * 列出项目的 AI 任务
 *
 * 安全（Security P0）：必须校验对 projectId 的读权限（禁止跨 org 列举）；
 * 普通用户步骤 error 脱敏。
 */
export const GET = withAuth(async (request) => {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const diagnostic = isPlatformAdmin(access.user);

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100);

  const tasks = await db.agentTask.findMany({
    where: { projectId },
    include: {
      steps: {
        orderBy: { stepIndex: "asc" },
        select: {
          id: true,
          stepIndex: true,
          skillId: true,
          agentName: true,
          title: true,
          status: true,
          riskLevel: true,
          requiresApproval: true,
          outputSummary: true,
          startedAt: true,
          completedAt: true,
          error: true,
          approvalRequests: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { deadlineAt: true, status: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const safeTasks = tasks.map((t) => ({
    ...t,
    steps: t.steps.map((s) => sanitizeListStepError(s, diagnostic)),
  }));

  return NextResponse.json({ tasks: safeTasks, templates: listTemplates() });
});

/**
 * POST /api/agent/tasks
 * 创建 AI 任务（编排器生成计划）
 *
 * 安全（Security P0）：创建可执行任务需项目管理权限（禁止跨 org 建任务）。
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { intent, projectId, templateId, triggerType } = body as {
    intent: string;
    projectId: string;
    templateId?: string;
    triggerType?: TriggerType;
  };

  if (!intent || !projectId) {
    return NextResponse.json({ error: "缺少 intent 或 projectId" }, { status: 400 });
  }

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const result = await generateFlowPlan({
    intent,
    projectId,
    userId: user.id,
    templateId,
    triggerType,
  });

  return NextResponse.json(result, { status: 201 });
});
