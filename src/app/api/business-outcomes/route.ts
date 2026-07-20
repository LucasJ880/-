import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  createBusinessOutcome,
  isEmployeeAiOutcomeEnabled,
  loadOrgCode,
  resolveEmployeeAiOrgId,
  type OutcomeSourceType,
} from "@/lib/employee-ai";
import { asOptionalString, asString } from "@/lib/employee-ai/http";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    await assertOrgMembership(user.id, orgId);
    const orgCode = await loadOrgCode(orgId);

    if (
      !isEmployeeAiOutcomeEnabled({
        userId: user.id,
        role: user.role,
        orgId,
        orgCode,
      })
    ) {
      return NextResponse.json(
        { error: "业务结果追踪未开启" },
        { status: 403 },
      );
    }

    const body = (await safeParseBody(req)) || {};
    if (
      !body.entityType ||
      !body.entityId ||
      !body.actionType ||
      !body.outcomeType ||
      !body.sourceType
    ) {
      return NextResponse.json(
        { error: "entityType/entityId/actionType/outcomeType/sourceType 必填" },
        { status: 400 },
      );
    }

    const outcome = await createBusinessOutcome({
      orgId,
      userId: user.id,
      feedbackEventId: asOptionalString(body.feedbackEventId),
      pendingActionId: asOptionalString(body.pendingActionId),
      skillExecutionId: asOptionalString(body.skillExecutionId),
      entityType: asString(body.entityType),
      entityId: asString(body.entityId),
      actionType: asString(body.actionType),
      actionOccurredAt: body.actionOccurredAt
        ? new Date(asString(body.actionOccurredAt))
        : undefined,
      outcomeType: asString(body.outcomeType),
      outcomeValue: body.outcomeValue,
      successSignals: body.successSignals,
      failureSignals: body.failureSignals,
      revenueImpact:
        typeof body.revenueImpact === "number" ? body.revenueImpact : null,
      confidence:
        typeof body.confidence === "number" ? body.confidence : undefined,
      sourceType: asString(body.sourceType) as OutcomeSourceType,
      sourceId: asOptionalString(body.sourceId),
      manuallyVerified: body.manuallyVerified === true,
      verifiedBy: body.manuallyVerified === true ? user.id : null,
    });

    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
