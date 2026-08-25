/**
 * GET  /api/agent-supervisor/runs/:id
 * POST /api/agent-supervisor/runs/:id  { action: resume|cancel }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import {
  loadSupervisorState,
  resumeSupervisorAfterApproval,
} from "@/lib/agent-supervisor";
import { cancelSupervisorRunGated } from "@/lib/agent-runtime/supervisor-cancel-gate";

async function resolveOrg(userId: string) {
  let orgId = await getUserActiveOrgId(userId);
  if (!orgId) {
    const m = await db.organizationMember.findFirst({
      where: { userId, status: "active" },
      select: { orgId: true },
    });
    orgId = m?.orgId ?? null;
  }
  return orgId;
}

export const GET = withAuth(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const orgId = await resolveOrg(user.id);
  if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });

  const run = await db.agentRun.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      status: true,
      intent: true,
      createdAt: true,
      updatedAt: true,
      supervisorState: true,
    },
  });
  if (!run) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  const state = await loadSupervisorState(orgId, id);
  return NextResponse.json({ run, state });
});

export const POST = withAuth(async (req, ctx, user) => {
  const { id } = await ctx.params;
  const orgId = await resolveOrg(user.id);
  if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = body.action || body.type;

  if (action === "cancel") {
    // B5：租户 + Supervisor 属主 + actor + 状态门（共享 AgentRun 表上的
    // v2/workforce/他人 run 一律拒绝；orgId 为服务端解析，绝不取自 body）
    const result = await cancelSupervisorRunGated({
      orgId,
      runId: id,
      actor: { userId: user.id, role: user.role },
    });
    if (result.decision === "not_found") {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    if (result.decision === "forbidden") {
      return NextResponse.json({ error: "无权取消该任务" }, { status: 403 });
    }
    // cancelled 或 already_terminal（幂等）：报告真实状态，不再谎报 cancelled
    return NextResponse.json({ ok: true, status: result.status });
  }

  if (action === "resume" || action === "approval_result" || action === "user_input") {
    const result = await resumeSupervisorAfterApproval({
      orgId,
      runId: id,
      userId: user.id,
      userRole: user.role,
    });
    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      text: result.text,
      pendingActionIds: result.pendingActionIds,
      finalSummary: result.state.finalSummary,
      timeline: result.state.userVisibleTimeline,
    });
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
});
