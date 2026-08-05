import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import {
  canTransitionSalesAction,
  isSalesActionStatus,
  validateSalesActionResolution,
} from "@/lib/sales/action-loop";
import { writeAuditLog, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

const PRIORITIES = new Set(["urgent", "high", "medium", "low"]);

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.opportunity.update");
  if (!scope.allowed) return NextResponse.json({ error: "无权更新销售行动" }, { status: 403 });

  const current = await db.salesAction.findFirst({
    where: { id, orgId: orgRes.orgId },
    include: {
      customer: { select: { createdById: true } },
      opportunity: { select: { createdById: true, assignedToId: true, nextFollowupAt: true, stage: true } },
    },
  });
  if (!current) return NextResponse.json({ error: "销售行动不存在" }, { status: 404 });
  if (scope.ownOnly) {
    const allowed = current.createdById === user.id || current.assignedToId === user.id ||
      current.customer.createdById === user.id || current.opportunity?.createdById === user.id ||
      current.opportunity?.assignedToId === user.id;
    if (!allowed) return NextResponse.json({ error: "无权更新该销售行动" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  const nextStatus = body.status === undefined ? current.status : body.status;
  if (!isSalesActionStatus(nextStatus) || !isSalesActionStatus(current.status)) {
    return NextResponse.json({ error: "行动状态无效" }, { status: 400 });
  }
  if (!canTransitionSalesAction(current.status, nextStatus)) {
    return NextResponse.json({ error: "已结束的行动不能重新打开" }, { status: 400 });
  }
  const resolutionNote = typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 2000) : current.resolutionNote;
  const dismissedReason = typeof body.dismissedReason === "string" ? body.dismissedReason.trim().slice(0, 2000) : current.dismissedReason;
  const resolutionError = validateSalesActionResolution({ status: nextStatus, resolutionNote, dismissedReason });
  if (resolutionError) return NextResponse.json({ error: resolutionError }, { status: 400 });
  if (
    nextStatus === "completed" &&
    ["contact", "record_followup"].includes(current.category) &&
    current.opportunity &&
    !["signed", "producing", "installing", "completed", "lost"].includes(current.opportunity.stage) &&
    (!current.opportunity.nextFollowupAt || current.opportunity.nextFollowupAt.getTime() <= Date.now())
  ) {
    return NextResponse.json(
      { error: "完成行动前，请先在客户互动中设置未来的下次跟进时间" },
      { status: 400 },
    );
  }

  if (body.status !== undefined) {
    data.status = nextStatus;
    if (nextStatus === "in_progress") {
      if (!current.assignedToId) data.assignedToId = user.id;
      if (!current.startedAt) data.startedAt = new Date();
    }
    if (nextStatus === "completed") {
      if (!current.startedAt) data.startedAt = new Date();
      data.completedAt = new Date();
      data.completedById = user.id;
      data.resolutionNote = resolutionNote;
      data.activeKey = null;
    }
    if (nextStatus === "dismissed") {
      data.dismissedAt = new Date();
      data.dismissedReason = dismissedReason;
      data.activeKey = null;
    }
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.has(body.priority)) return NextResponse.json({ error: "优先级无效" }, { status: 400 });
    data.priority = body.priority;
  }
  if (body.dueAt !== undefined) {
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "截止时间无效" }, { status: 400 });
    data.dueAt = dueAt;
  }
  if (body.assignedToId !== undefined) {
    const assignedToId = body.assignedToId || null;
    if (scope.ownOnly && assignedToId && assignedToId !== user.id) {
      return NextResponse.json({ error: "只有销售经理可以把行动分配给其他成员" }, { status: 403 });
    }
    if (assignedToId) {
      const member = await db.organizationMember.findUnique({
        where: { orgId_userId: { orgId: orgRes.orgId, userId: assignedToId } },
        select: { status: true },
      });
      if (member?.status !== "active") return NextResponse.json({ error: "负责人不是当前企业的有效成员" }, { status: 400 });
    }
    data.assignedToId = assignedToId;
  }

  const action = await db.$transaction(async (tx) => {
    const updated = await tx.salesAction.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        opportunity: { select: { id: true, title: true, stage: true } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      orgId: orgRes.orgId,
      action: AUDIT_ACTIONS.UPDATE,
      targetType: AUDIT_TARGETS.SALES_ACTION,
      targetId: id,
      beforeData: { status: current.status, assignedToId: current.assignedToId, dueAt: current.dueAt },
      afterData: data,
      request,
    });
    return updated;
  });
  return NextResponse.json({ action });
});
