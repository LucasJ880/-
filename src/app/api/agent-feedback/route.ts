import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  createHumanFeedbackEvent,
  isEmployeeAiFeedbackEnabled,
  listOwnFeedbackEvents,
  loadOrgCode,
  resolveEmployeeAiOrgId,
  type FeedbackScope,
  type HumanDecision,
} from "@/lib/employee-ai";
import { asOptionalString, asString } from "@/lib/employee-ai/http";

export const GET = withAuth(async (_req, _ctx, user) => {
  const orgId = await resolveEmployeeAiOrgId(user.id);
  if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
  await assertOrgMembership(user.id, orgId);
  const events = await listOwnFeedbackEvents({ orgId, userId: user.id });
  return NextResponse.json({ events });
});

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    await assertOrgMembership(user.id, orgId);
    const orgCode = await loadOrgCode(orgId);

    if (
      !isEmployeeAiFeedbackEnabled({
        userId: user.id,
        role: user.role,
        orgId,
        orgCode,
      })
    ) {
      return NextResponse.json(
        { error: "反馈学习未对该账号/组织开启" },
        { status: 403 },
      );
    }

    const body = (await safeParseBody(req)) || {};
    if (!body.taskType || !body.humanDecision || !body.aiOutputRef) {
      return NextResponse.json(
        { error: "taskType / humanDecision / aiOutputRef 必填" },
        { status: 400 },
      );
    }

    const event = await createHumanFeedbackEvent({
      orgId,
      userId: user.id,
      taskType: asString(body.taskType),
      humanDecision: body.humanDecision as HumanDecision,
      aiOutputRef: body.aiOutputRef as Record<string, unknown>,
      aiOutputSnapshot: body.aiOutputSnapshot,
      humanEditedOutput: body.humanEditedOutput,
      reasonCode: asOptionalString(body.reasonCode),
      reasonText: asOptionalString(body.reasonText),
      feedbackScope: (asOptionalString(body.feedbackScope) as FeedbackScope) || "personal_only",
      consentConfirmed: body.consentConfirmed !== false,
      agentRunId: asOptionalString(body.agentRunId),
      skillExecutionId: asOptionalString(body.skillExecutionId),
      pendingActionId: asOptionalString(body.pendingActionId),
      supervisorStepId: asOptionalString(body.supervisorStepId),
      workerType: asOptionalString(body.workerType),
      skillSlug: asOptionalString(body.skillSlug),
    });

    return NextResponse.json({ ok: true, event });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
