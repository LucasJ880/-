/**
 * POST /api/projects/[id]/handoff/preview
 * 只读预览：不创建 Project / Task / completed handoff
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  buildHandoffPreview,
  canOverrideHandoff,
  canPreviewHandoff,
  type HandoffAccessContext,
} from "@/lib/projects/handoff";
import { isSuperAdmin } from "@/lib/rbac/roles";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = access.project;
  if (!project.orgId) {
    return NextResponse.json(
      { error: "项目未归属企业，无法交接", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const handoffCtx: HandoffAccessContext = {
    platformRole: user.role,
    orgRole: access.orgRole,
    hasMembership: Boolean(access.orgRole),
    userId: user.id,
  };

  if (
    !canPreviewHandoff(handoffCtx, {
      canReadTender: true,
    })
  ) {
    return NextResponse.json(
      { error: "无权预览交接", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  // 裸 user/operations 无显式能力时拒绝（access 层已覆盖；双保险）
  if (
    !isSuperAdmin(user.role) &&
    !access.orgRole &&
    project.ownerId !== user.id
  ) {
    const om = await getOrgMembership(user.id, project.orgId);
    if (!om || om.status !== "active") {
      return NextResponse.json(
        { error: "无权预览交接", code: "FORBIDDEN" },
        { status: 403 },
      );
    }
  }

  const write = await requireProjectWriteAccess(request, id);
  const canManageTender = !(write instanceof NextResponse);

  const preview = await buildHandoffPreview({
    sourceProjectId: id,
    orgId: project.orgId,
    canOverride: canOverrideHandoff(handoffCtx),
    useHistoricalOverride: Boolean(body.useHistoricalOverride),
    overrideReason: body.overrideReason ?? null,
    conditionalFlags: body.conditionalFlags ?? null,
  });

  if ("error" in preview) {
    return NextResponse.json(
      { error: preview.error },
      { status: preview.status },
    );
  }

  // 加载可选负责人（当前组织 active 成员）
  const members = await db.organizationMember.findMany({
    where: { orgId: project.orgId, status: "active" },
    select: {
      userId: true,
      user: { select: { id: true, name: true, status: true } },
    },
    take: 100,
  });
  const ownerCandidates = members
    .filter((m) => m.user.status === "active")
    .map((m) => ({ id: m.user.id, name: m.user.name }));

  return NextResponse.json({
    ...preview,
    canManageTender,
    ownerCandidates,
  });
});
