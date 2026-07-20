/**
 * POST /api/agent-supervisor/runs
 * 显式启动主管 AI 任务（关联 AgentSession + AgentRun）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import {
  isSupervisorEnabled,
  runSupervisor,
} from "@/lib/agent-supervisor";
import { createAgentRun } from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";

export const maxDuration = 300;

export const POST = withAuth(async (req, _ctx, user) => {
  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message 必填" }, { status: 400 });
  }

  let orgId = await getUserActiveOrgId(user.id);
  if (!orgId) {
    const m = await db.organizationMember.findFirst({
      where: { userId: user.id, status: "active" },
      select: { orgId: true },
    });
    orgId = m?.orgId ?? null;
  }
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { code: true },
  });

  if (
    !isSupervisorEnabled({
      userId: user.id,
      role: user.role,
      orgId,
      orgCode: org?.code,
    })
  ) {
    return NextResponse.json(
      { error: "主管 AI 未对该账号/组织开启（Feature Flag）" },
      { status: 403 },
    );
  }

  const session = await getOrCreateAgentSession({
    orgId,
    userId: user.id,
    channel: "web_supervisor",
    channelUserId: user.id,
  });

  const { run } = await createAgentRun({
    orgId,
    sessionId: session.id,
    runType: "supervisor",
    intent: "supervisor",
    metadata: { mode: body.mode || "supervisor" },
  });

  const result = await runSupervisor({
    sessionId: session.id,
    runId: run.id,
    orgId,
    userId: user.id,
    userRole: user.role,
    content: message,
    pageContext: body.pageContext,
    forceMode:
      body.mode === "quick" || body.mode === "supervisor" || body.mode === "auto"
        ? body.mode
        : "supervisor",
  });

  const workerLabel: Record<string, string> = {
    sales: "销售",
    tender: "投标",
    marketing: "营销",
    analytics: "分析",
  };

  return NextResponse.json({
    ok: result.ok,
    runId: run.id,
    sessionId: session.id,
    status: result.status,
    text: result.text,
    pendingActionIds: result.pendingActionIds,
    timeline: result.state.userVisibleTimeline,
    objective: result.state.objective,
    mode: result.state.mode,
    fallbackUsed: result.state.fallbackUsed === true,
    knowledgeRetrieval: result.state.knowledgeRetrieval || null,
    finalSummary: result.state.finalSummary || null,
    plan: result.state.plan.map((s) => ({
      id: s.id,
      order: s.order,
      worker: s.worker,
      workerName: `${workerLabel[s.worker] || s.worker}数字员工`,
      objective: s.objective,
      status: s.status,
      resultSummary: s.resultSummary || null,
      error: s.error || null,
    })),
  });
});
