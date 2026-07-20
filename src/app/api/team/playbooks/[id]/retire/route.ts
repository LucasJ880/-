import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  canReviewTeamLearning,
  resolveEmployeeAiOrgId,
  retirePlaybook,
  rollbackPlaybook,
} from "@/lib/employee-ai";
import { safeParseBody } from "@/lib/common/api-helpers";

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
    if (body.action === "rollback") {
      const playbook = await rollbackPlaybook({
        orgId,
        userId: user.id,
        targetId: id,
      });
      return NextResponse.json({ ok: true, playbook });
    }
    const playbook = await retirePlaybook({
      orgId,
      userId: user.id,
      id,
    });
    return NextResponse.json({ ok: true, playbook });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
