import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectWriteAccess,
  requireProjectReadAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isSuperAdmin, hasOrgRole, hasProjectRole } from "@/lib/rbac/roles";
import { emitProjectPatchEvents } from "@/lib/project-discussion/system-events";

const detailInclude = {
  owner: { select: { id: true, name: true, email: true } },
  org: { select: { id: true, name: true, code: true, status: true } },
  _count: { select: { tasks: true, environments: true, members: true } },
  externalRef: true,
  intelligence: true,
  documents: {
    select: {
      id: true,
      title: true,
      url: true,
      fileType: true,
      fileSize: true,
      sortOrder: true,
      parseStatus: true,
      aiSummaryStatus: true,
      source: true,
      createdAt: true,
    },
    orderBy: { sortOrder: "asc" as const },
  },
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
  // tenderStatus 由 advance-stage 服务统一同步，不允许 PATCH 直接修改
  if (body.tenderStatus !== undefined) {
    return NextResponse.json(
      {
        error: "tenderStatus 不允许通过 PATCH 直接修改，请使用 advance-stage 接口",
        hint: "POST /api/projects/[id]/advance-stage",
      },
      { status: 400 }
    );
  }
  if (body.priority !== undefined) data.priority = body.priority;

  // 进展时间戳字段 — 必须通过 POST /api/projects/[id]/advance-stage 更新
  // 此处拦截，防止绕过规则校验、审计、通知链路
  const STAGE_PROGRESS_FIELDS = [
    "distributedAt", "interpretedAt", "supplierInquiredAt",
    "supplierQuotedAt", "submittedAt",
  ] as const;
  const attemptedProgressFields = STAGE_PROGRESS_FIELDS.filter(
    (f) => body[f] !== undefined
  );
  if (attemptedProgressFields.length > 0) {
    return NextResponse.json(
      {
        error: `进展字段 ${attemptedProgressFields.join(", ")} 不允许通过 PATCH 直接修改，请使用 advance-stage 接口`,
        hint: "POST /api/projects/[id]/advance-stage",
      },
      { status: 400 }
    );
  }

  // 非进展日期字段 — 仍可通过 PATCH 更新
  const editableDateFields = [
    "publicDate", "questionCloseDate", "closeDate", "awardDate",
  ] as const;
  for (const f of editableDateFields) {
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
    },
    afterData: {
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status,
    },
    request,
  });

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
