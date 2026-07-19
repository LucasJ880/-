import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  decideOrgProjectRule,
  listOrgProjectRules,
} from "@/lib/projects/org-rules";
import { db } from "@/lib/db";
import { hasOrgRole } from "@/lib/rbac/roles";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const status = searchParams.get("status") || undefined;
  const sourceProjectId = searchParams.get("sourceProjectId") || undefined;
  const rules = await listOrgProjectRules({
    orgId: orgRes.orgId,
    status: status || undefined,
    sourceProjectId: sourceProjectId || undefined,
  });
  return NextResponse.json({ orgId: orgRes.orgId, rules });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;

  const membership = await db.organizationMember.findFirst({
    where: { orgId: orgRes.orgId, userId: user.id, status: "active" },
    select: { role: true },
  });
  const canDecide =
    user.role === "admin" ||
    user.role === "super_admin" ||
    (!!membership && hasOrgRole(membership.role, "org_admin"));
  if (!canDecide) {
    return NextResponse.json({ error: "仅组织管理员可确认规则" }, { status: 403 });
  }

  if (
    body.action === "decide" &&
    typeof body.ruleId === "string" &&
    (body.decision === "activate" ||
      body.decision === "reject" ||
      body.decision === "archive")
  ) {
    const rule = await decideOrgProjectRule({
      ruleId: body.ruleId,
      orgId: orgRes.orgId,
      userId: user.id,
      decision: body.decision,
    });
    return NextResponse.json({ rule });
  }

  return NextResponse.json({ error: "action 无效" }, { status: 400 });
});
