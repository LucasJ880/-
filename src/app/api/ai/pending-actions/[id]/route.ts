/**
 * POST /api/ai/pending-actions/[id]
 * body: { decision: "approve" | "reject", reason?: string, orgId?: string }
 *
 * 批准 → 调 executor 执行真实副作用 → 返回 { ok, resultRef, message }
 * 拒绝 → 只标状态，不执行
 *
 * Phase 3B-A：确认时必须与服务端 activeOrg 一致；跨组织旧 Action fail-closed。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  approveApprovalItem,
  rejectApprovalItem,
} from "@/lib/approval/port";
import { canDecideTeamApproval } from "@/lib/marketing/team";
import { getOrgMembership } from "@/lib/auth";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";
import { canConfirmPendingActionInActiveOrg } from "@/lib/assistant/thread-org-backfill";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  const claimedBodyOrgId =
    typeof body.orgId === "string" ? body.orgId.trim() : null;

  const orgRes = await resolveAssistantOrgId(request, user, claimedBodyOrgId);
  if (!orgRes.ok) return orgRes.response;

  const action = await db.pendingAction.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      createdById: true,
      title: true,
      preview: true,
      expiresAt: true,
      orgId: true,
      projectId: true,
      approverUserId: true,
    },
  });
  if (!action) {
    return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
  }

  const orgGate = canConfirmPendingActionInActiveOrg({
    actionOrgId: action.orgId,
    activeOrgId: orgRes.orgId,
  });
  if (!orgGate.ok) {
    return NextResponse.json(
      {
        error: "当前企业与动作所属企业不一致，无法确认",
        code: orgGate.code,
      },
      { status: 403 },
    );
  }

  // Phase 2A：企业业务审批必须是该企业成员（平台超管无 membership 不可代批）
  if (action.orgId) {
    const membership = await getOrgMembership(user.id, action.orgId);
    if (!membership || membership.status !== "active") {
      return NextResponse.json(
        { error: "无企业成员身份，不能审批该企业动作" },
        { status: 403 },
      );
    }
  }
  if (
    !(await canDecideTeamApproval(action, {
      userId: user.id,
      role: user.role,
      orgId: orgRes.orgId,
    }))
  ) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  const decision = body.decision;
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  if (decision === "approve") {
    const result = await approveApprovalItem("pending_action", id, {
      userId: user.id,
      role: user.role,
      orgId: orgRes.orgId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "执行失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "executed",
      resultRef: result.resultRef,
      message: result.message,
    });
  }

  if (decision === "reject") {
    const result = await rejectApprovalItem("pending_action", id, {
      userId: user.id,
      role: user.role,
      orgId: orgRes.orgId,
      note: reason,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "拒绝失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  return NextResponse.json(
    { error: "decision 必须为 approve 或 reject" },
    { status: 400 },
  );
});
