/**
 * POST /api/marketing/plan-items/[id]/task
 * 计划项一键建任务：若挂了 findingId 则复用 Finding→Task；否则按计划项标题建任务。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const item = await db.marketingPlanItem.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!item) return NextResponse.json({ error: "计划项不存在" }, { status: 404 });

  if (item.taskId) {
    const existing = await db.task.findUnique({ where: { id: item.taskId } });
    return NextResponse.json({ item, task: existing, reused: true });
  }

  // 有关联 Finding 时走 Finding 专用接口逻辑（保持幂等与回填一致）
  if (item.findingId) {
    const finding = await db.marketingFinding.findFirst({
      where: { id: item.findingId, orgId: orgRes.orgId },
    });
    if (finding?.taskId) {
      await db.marketingPlanItem.update({
        where: { id: item.id },
        data: { taskId: finding.taskId, status: "tasked" },
      });
      const task = await db.task.findUnique({ where: { id: finding.taskId } });
      return NextResponse.json({ item: { ...item, taskId: finding.taskId }, task, reused: true });
    }
  }

  let projectId =
    typeof body.projectId === "string" ? body.projectId : null;
  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, orgId: orgRes.orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在或不属于当前组织" }, { status: 400 });
    }
  } else {
    const project = await db.project.findFirst({
      where: {
        orgId: orgRes.orgId,
        workflowTemplate: "marketing_growth_center",
        status: "active",
      },
      select: { id: true },
    });
    projectId =
      project?.id ??
      (
        await db.project.create({
          data: {
            orgId: orgRes.orgId,
            name: "Growth Center 增长任务",
            description: "由营销计划项生成的执行任务。",
            workflowTemplate: "marketing_growth_center",
            category: "marketing",
            ownerId: user.id,
          },
          select: { id: true },
        })
      ).id;
  }

  const priority =
    item.priority === "urgent" || item.priority === "high" || item.priority === "low"
      ? item.priority
      : "medium";

  const task = await db.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title: item.title.slice(0, 300),
        description: item.description || null,
        priority,
        projectId,
        creatorId: user.id,
        assigneeId: typeof body.assigneeId === "string" ? body.assigneeId : user.id,
        dueDate: item.dueDate,
      },
    });
    await tx.taskActivity.create({
      data: {
        action: "created_from_marketing_plan_item",
        detail: item.title,
        taskId: created.id,
        actorId: user.id,
      },
    });
    await tx.marketingPlanItem.update({
      where: { id: item.id },
      data: { taskId: created.id, status: "tasked" },
    });
    if (item.findingId) {
      await tx.marketingFinding.updateMany({
        where: { id: item.findingId, orgId: orgRes.orgId, taskId: null },
        data: { taskId: created.id, status: "tasked" },
      });
    }
    return created;
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    projectId,
    action: "marketing_plan_item_to_task",
    targetType: "marketing_plan_item",
    targetId: item.id,
    afterData: { taskId: task.id },
    request,
  });
  return NextResponse.json({ task }, { status: 201 });
});
