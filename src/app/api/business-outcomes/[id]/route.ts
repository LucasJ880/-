import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  resolveEmployeeAiOrgId,
  updateBusinessOutcome,
} from "@/lib/employee-ai";
import { asOptionalString } from "@/lib/employee-ai/http";

export const PATCH = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    await assertOrgMembership(user.id, orgId);
    const body = (await safeParseBody(req)) || {};

    const outcome = await updateBusinessOutcome({
      orgId,
      userId: user.id,
      id,
      patch: {
        outcomeType: asOptionalString(body.outcomeType) ?? undefined,
        outcomeValue: body.outcomeValue,
        successSignals: body.successSignals,
        failureSignals: body.failureSignals,
        revenueImpact:
          typeof body.revenueImpact === "number" ? body.revenueImpact : null,
        manuallyVerified: body.manuallyVerified === true,
      },
    });
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
