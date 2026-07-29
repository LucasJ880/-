/**
 * POST /api/projects/[id]/handoff/execute
 * 不信任 preview；重新读库；事务 + 幂等
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  canExecuteHandoff,
  canOverrideHandoff,
  executeAwardHandoff,
  HandoffError,
  type HandoffAccessContext,
} from "@/lib/projects/handoff";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = access.project;
  if (!project.orgId) {
    return NextResponse.json(
      { error: "项目未归属企业，无法交接", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const handoffCtx: HandoffAccessContext = {
    platformRole: user.role,
    orgRole: access.orgRole,
    hasMembership: Boolean(access.orgRole),
    userId: user.id,
  };

  if (
    !canExecuteHandoff(handoffCtx, {
      canManageTender: true,
    })
  ) {
    return NextResponse.json(
      { error: "无权执行交接", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));

  // 拒绝伪造来源 / 金额 / 审批
  if (body.sourceTenderProjectId && body.sourceTenderProjectId !== id) {
    return NextResponse.json(
      { error: "不能伪造 sourceTenderProjectId", code: "FIELD_FORBIDDEN" },
      { status: 400 },
    );
  }
  for (const key of [
    "winningBidPrice",
    "estimatedValue",
    "tenderStatus",
    "workDomain",
    "technicalApproved",
    "financialApproved",
  ]) {
    if (key in body) {
      return NextResponse.json(
        { error: `不允许通过交接 payload 修改 ${key}`, code: "FIELD_FORBIDDEN" },
        { status: 400 },
      );
    }
  }

  try {
    const result = await executeAwardHandoff({
      sourceProjectId: id,
      orgId: project.orgId,
      actorUserId: user.id,
      actorName: user.name || "用户",
      canOverride: canOverrideHandoff(handoffCtx),
      payload: {
        deliveryOwnerId: body.deliveryOwnerId,
        deliveryName: body.deliveryName,
        description: body.description,
        plannedCompletionDate: body.plannedCompletionDate,
        conditionalFlags: body.conditionalFlags,
        overrideReason: body.overrideReason,
        note: body.note,
      },
    });

    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
    });
  } catch (err) {
    if (err instanceof HandoffError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error("[handoff.execute]", err);
    return NextResponse.json(
      { error: "交接失败", code: "INTERNAL" },
      { status: 500 },
    );
  }
});
