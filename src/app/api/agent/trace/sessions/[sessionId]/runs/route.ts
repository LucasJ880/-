/**
 * GET /api/agent/trace/sessions/[sessionId]/runs?orgId=
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listAgentRunsForSession } from "@/lib/agent-runtime/trace";

export const GET = withAuth<{ sessionId: string }>(
  async (request, ctx, user) => {
    const { sessionId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const orgRes = await resolveRequestOrgIdForUser(
      user,
      searchParams.get("orgId"),
    );
    if (!orgRes.ok) return orgRes.response;

    const role = user.role ?? "user";
    const scope =
      role === "admin" || role === "super_admin" ? "org" : "self";

    const runs = await listAgentRunsForSession({
      orgId: orgRes.orgId,
      userId: user.id,
      sessionId,
      scope,
    });
    if (!runs) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }
    return NextResponse.json({ orgId: orgRes.orgId, sessionId, runs });
  },
);
