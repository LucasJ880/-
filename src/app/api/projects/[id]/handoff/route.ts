/**
 * GET /api/projects/[id]/handoff
 * 查看来源投标项目的交接记录
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import {
  canPreviewHandoff,
  HANDOFF_TYPE_AWARD_TO_DELIVERY,
  type HandoffAccessContext,
} from "@/lib/projects/handoff";

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = access.project;
  if (!project.orgId) {
    return NextResponse.json(
      { error: "项目未归属企业", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const handoffCtx: HandoffAccessContext = {
    platformRole: user.role,
    orgRole: access.orgRole,
    hasMembership: Boolean(access.orgRole),
    userId: user.id,
  };
  if (!canPreviewHandoff(handoffCtx, { canReadTender: true })) {
    return NextResponse.json(
      { error: "无权查看交接记录", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const handoff = await db.projectHandoff.findUnique({
    where: {
      orgId_sourceTenderProjectId_handoffType: {
        orgId: project.orgId,
        sourceTenderProjectId: id,
        handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
      },
    },
    select: {
      id: true,
      status: true,
      handoffType: true,
      sourceTenderProjectId: true,
      targetDeliveryProjectId: true,
      deliveryOwnerId: true,
      initiatedById: true,
      overrideReason: true,
      failureCode: true,
      failureMessage: true,
      retryCount: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      createdAt: true,
      updatedAt: true,
      deliveryOwner: { select: { id: true, name: true } },
      initiatedBy: { select: { id: true, name: true } },
      targetDeliveryProject: {
        select: { id: true, name: true, workDomain: true },
      },
    },
  });

  return NextResponse.json({
    handoff: handoff ?? null,
    href: handoff?.targetDeliveryProjectId
      ? `/ops/projects/${handoff.targetDeliveryProjectId}`
      : null,
  });
});
