/**
 * GET /api/agent/trace?orgId=&limit=
 * 列出当前组织下 Agent Session（只读 Trace）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listAgentSessionsForTrace } from "@/lib/agent-runtime/trace";

export const GET = withAuth(async (request, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const role = user.role ?? "user";
  const scope =
    role === "admin" || role === "super_admin" ? "org" : "self";
  const limitStr = searchParams.get("limit");

  try {
    const sessions = await listAgentSessionsForTrace({
      orgId: orgRes.orgId,
      userId: user.id,
      scope,
      limit: limitStr ? parseInt(limitStr, 10) : 30,
    });
    return NextResponse.json({
      orgId: orgRes.orgId,
      scope,
      sessions,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
});
