import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  resolveEmployeeAiOrgId,
  updateHumanFeedbackEvent,
  type FeedbackScope,
} from "@/lib/employee-ai";
import { asOptionalString } from "@/lib/employee-ai/http";

export const PATCH = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    await assertOrgMembership(user.id, orgId);
    const body = (await safeParseBody(req)) || {};

    const event = await updateHumanFeedbackEvent({
      orgId,
      userId: user.id,
      id,
      patch: {
        feedbackScope: asOptionalString(body.feedbackScope) as FeedbackScope | undefined,
        reasonCode: asOptionalString(body.reasonCode),
        reasonText: asOptionalString(body.reasonText),
        humanEditedOutput: body.humanEditedOutput,
      },
    });
    return NextResponse.json({ ok: true, event });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
