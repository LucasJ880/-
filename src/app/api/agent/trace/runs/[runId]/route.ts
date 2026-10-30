/**
 * GET /api/agent/trace/runs/[runId]?orgId=
 * Run 详情 + Event 时间线 + 关联 PendingAction
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { getAgentRunTrace } from "@/lib/agent-runtime/trace";
import { isSuperAdmin } from "@/lib/rbac/roles";

export const GET = withAuth<{ runId: string }>(async (request, ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  const { runId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const role = user.role ?? "user";
  const scope =
    isSuperAdmin(role) ? "org" : "self";

  const detail = await getAgentRunTrace({
    orgId: orgRes.orgId,
    userId: user.id,
    runId,
    scope,
  });
  if (!detail) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json(detail);
});
