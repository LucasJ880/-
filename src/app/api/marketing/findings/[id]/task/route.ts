import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

export const POST = withAuth(async (request, context, user) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const finding = await db.marketingFinding.findFirst({ where: { id, orgId: orgRes.orgId } });
  if (!finding) return NextResponse.json({ error: "营销问题不存在" }, { status: 404 });
  if (finding.taskId) {
    const existing = await db.task.findUnique({ where: { id: finding.taskId } });
    return NextResponse.json({ finding, task: existing, reused: true });
  }

  let projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (projectId) {
    const project = await db.project.findFirst({ where: { id: projectId, orgId: orgRes.orgId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "项目不存在或不属于当前组织" }, { status: 400 });
  } else {
    const project = await db.project.findFirst({ where: { orgId: orgRes.orgId, workflowTemplate: "marketing_growth_center", status: "active" }, select: { id: true } });
    projectId = project?.id ?? (await db.project.create({
      data: {
        orgId: orgRes.orgId,
        name: "Growth Center 增长任务",
        description: "由营销体检自动生成的执行任务。",
        workflowTemplate: "marketing_growth_center",
        category: "marketing",
        ownerId: user.id,
      },
      select: { id: true },
    })).id;
  }

  const priority = finding.severity === "critical" ? "urgent" : finding.severity === "high" ? "high" : finding.severity === "low" ? "low" : "medium";
  const task = await db.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title: `[${finding.dimension}] ${finding.title}`,
        description: [finding.description, finding.currentValue && `当前：${finding.currentValue}`, finding.expectedValue && `目标：${finding.expectedValue}`, finding.evidenceUrl && `证据：${finding.evidenceUrl}`].filter(Boolean).join("\n\n"),
        priority,
        projectId,
        creatorId: user.id,
        assigneeId: typeof body.assigneeId === "string" ? body.assigneeId : user.id,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
      },
    });
    await tx.taskActivity.create({ data: { action: "created_from_marketing_finding", detail: finding.title, taskId: created.id, actorId: user.id } });
    await tx.marketingFinding.update({ where: { id: finding.id }, data: { status: "tasked", taskId: created.id } });
    await tx.marketingPlanItem.updateMany({ where: { orgId: orgRes.orgId, findingId: finding.id, taskId: null }, data: { taskId: created.id, status: "tasked" } });
    return created;
  });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, projectId, action: "marketing_finding_to_task", targetType: "marketing_finding", targetId: finding.id, afterData: { taskId: task.id }, request });
  return NextResponse.json({ task }, { status: 201 });
});
