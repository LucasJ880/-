/**
 * PATCH /api/marketing/mmm/scenarios/[id]
 * 预算情景人工审批：draft→pending_approval→approved|rejected。
 * 仅更新青砚库内状态，绝不调用广告平台改预算。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import {
  isMmmScenarioStatus,
  validateScenarioTransition,
} from "@/lib/marketing/mmm-scenario";

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const scenario = await db.mmmBudgetScenario.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!scenario) {
    return NextResponse.json({ error: "预算情景不存在" }, { status: 404 });
  }

  const nextStatus = body.status;
  if (!isMmmScenarioStatus(nextStatus)) {
    return NextResponse.json(
      { error: "status 须为 draft / pending_approval / approved / rejected" },
      { status: 400 },
    );
  }

  const transitionError = validateScenarioTransition(scenario.status, nextStatus);
  if (transitionError) {
    return NextResponse.json({ error: transitionError }, { status: 400 });
  }

  if (scenario.status === nextStatus) {
    return NextResponse.json({ scenario, unchanged: true });
  }

  const updated = await db.mmmBudgetScenario.update({
    where: { id },
    data: { status: nextStatus },
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "marketing_mmm_scenario_status",
    targetType: "mmm_budget_scenario",
    targetId: id,
    beforeData: { status: scenario.status },
    afterData: { status: updated.status },
    request,
  });

  return NextResponse.json({
    scenario: updated,
    note:
      nextStatus === "approved"
        ? "情景已批准。请人工到广告后台执行预算调整；青砚不会自动改投放。"
        : undefined,
  });
});
