import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

import {
  EmployeeAiAccessError,
  assertOrgMembership,
  canReviewTeamLearning,
  getTeamLearningMetrics,
  resolveEmployeeAiOrgId,
} from "@/lib/employee-ai";

export const GET = withAuth(async (_req, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    const { memberRole } = await assertOrgMembership(user.id, orgId);

    if (!canReviewTeamLearning({ platformRole: user.role, memberRole })) {
      return NextResponse.json({ error: "需要主管或管理员权限" }, { status: 403 });
    }

    const candidates = await db.candidatePractice.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const metrics = await getTeamLearningMetrics({ orgId });

    return NextResponse.json({ candidates, metrics });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
