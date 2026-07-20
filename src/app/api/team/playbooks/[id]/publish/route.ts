import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  canReviewTeamLearning,
  publishPlaybook,
  resolveEmployeeAiOrgId,
} from "@/lib/employee-ai";

export const POST = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    const { memberRole } = await assertOrgMembership(user.id, orgId);
    if (!canReviewTeamLearning({ platformRole: user.role, memberRole })) {
      return NextResponse.json({ error: "需要主管或管理员权限" }, { status: 403 });
    }
    const body = (await safeParseBody(req)) || {};
    const playbook = await publishPlaybook({
      orgId,
      userId: user.id,
      id,
      effectiveFrom: body.effectiveFrom
        ? new Date(String(body.effectiveFrom))
        : undefined,
      effectiveTo: body.effectiveTo
        ? new Date(String(body.effectiveTo))
        : undefined,
    });
    return NextResponse.json({ ok: true, playbook });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
