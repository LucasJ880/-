import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectWriteAccess,
  requireProjectReadAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isSuperAdmin, hasOrgRole, hasProjectRole } from "@/lib/rbac/roles";
import { notifyProjectStatusChange } from "@/lib/webhook/dispatcher";
import { emitProjectPatchEvents } from "@/lib/project-discussion/system-events";

const detailInclude = {
  owner: { select: { id: true, name: true, email: true } },
  org: { select: { id: true, name: true, code: true, status: true } },
  _count: { select: { tasks: true, environments: true, members: true } },
  externalRef: true,
  intelligence: true,
  documents: { orderBy: { sortOrder: "asc" as const } },
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id },
    include: detailInclude,
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const { user, projectRole, orgRole } = access;
  const canManage =
    isSuperAdmin(user.role) ||
    project.ownerId === user.id ||
    (!!project.orgId &&
      !!orgRole &&
      hasOrgRole(orgRole, "org_admin")) ||
    (!!projectRole && hasProjectRole(projectRole, "project_admin"));

  return NextResponse.json({
    project,
    myProjectRole: access.projectRole,
    myOrgRole: access.orgRole,
    canManage,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project: beforeProject } = access;

  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.color !== undefined) data.color = body.color;
  if (body.status !== undefined) data.status = body.status;
  if (body.tenderStatus !== undefined) data.tenderStatus = body.tenderStatus;
  if (body.priority !== undefined) data.priority = body.priority;

  const dateFields = [
    "publicDate", "questionCloseDate", "closeDate",
    "distributedAt", "interpretedAt", "supplierQuotedAt",
    "submittedAt", "awardDate",
  ] as const;
  for (const f of dateFields) {
    if (body[f] !== undefined) {
      data[f] = body[f] ? new Date(body[f]) : null;
    }
  }

  if (body.orgId !== undefined) {
    return NextResponse.json(
      { error: "不允许通过此接口修改组织归属" },
      { status: 400 }
    );
  }

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id },
      data,
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { tasks: true, environments: true } },
      },
    });

    await emitProjectPatchEvents(
      id,
      beforeProject as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      { id: user.id, name: user.name },
      tx
    );

    return updated;
  });

  await logAudit({
    userId: user.id,
    orgId: beforeProject.orgId ?? undefined,
    projectId: id,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: id,
    beforeData: {
      name: beforeProject.name,
      description: beforeProject.description,
      color: beforeProject.color,
      status: beforeProject.status,
      tenderStatus: beforeProject.tenderStatus,
    },
    afterData: {
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status,
      tenderStatus: project.tenderStatus,
    },
    request,
  });

  if (
    body.tenderStatus !== undefined &&
    beforeProject.tenderStatus !== project.tenderStatus &&
    beforeProject.sourceSystem
  ) {
    notifyProjectStatusChange({
      projectId: id,
      oldStatus: beforeProject.tenderStatus || "new",
      newStatus: project.tenderStatus || "new",
      updatedBy: user.email,
    }).catch((err) => console.error("[Webhook] dispatch failed:", err));
  }

  return NextResponse.json(project);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project: beforeProject } = access;

  await db.task.updateMany({
    where: { projectId: id },
    data: { projectId: null },
  });

  await db.project.delete({ where: { id } });

  await logAudit({
    userId: user.id,
    orgId: beforeProject.orgId ?? undefined,
    projectId: id,
    action: AUDIT_ACTIONS.DELETE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: id,
    beforeData: { name: beforeProject.name, orgId: beforeProject.orgId },
    request,
  });

  return NextResponse.json({ success: true });
}
