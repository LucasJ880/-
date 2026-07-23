import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

import {
  EmployeeAiAccessError,
  assertOrgMembership,
  canReviewTeamLearning,
  isEmployeeAiPlaybooksEnabled,
  loadOrgCode,
  resolveEmployeeAiOrgId,
  reviewCandidatePractice,
} from "@/lib/employee-ai";
import { asOptionalString } from "@/lib/employee-ai/http";

export const POST = withAuth<{ id: string }>(async (req, ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    const { memberRole } = await assertOrgMembership(user.id, orgId);
    if (!canReviewTeamLearning({ platformRole: user.role, memberRole })) {
      return NextResponse.json({ error: "需要主管或管理员权限" }, { status: 403 });
    }

    const orgCode = await loadOrgCode(orgId);
    if (
      !isEmployeeAiPlaybooksEnabled({
        userId: user.id,
        role: user.role,
        orgId,
        orgCode,
      })
    ) {
      return NextResponse.json({ error: "Playbook 功能未开启" }, { status: 403 });
    }

    const body = (await safeParseBody(req)) || {};
    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json({ error: "decision 须为 approve|reject" }, { status: 400 });
    }

    const result = await reviewCandidatePractice({
      orgId,
      userId: user.id,
      id,
      decision: body.decision,
      rejectionReason: asOptionalString(body.rejectionReason) ?? undefined,
      department: asOptionalString(body.department) ?? undefined,
      roleScope: asOptionalString(body.roleScope) ?? undefined,
      exceptions: body.exceptions,
      effectiveFrom: body.effectiveFrom
        ? new Date(String(body.effectiveFrom))
        : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
