/**
 * GET  /api/projects/[id]/org-rules — 本项目提出的企业规则
 * POST /api/projects/[id]/org-rules — 确认/拒绝草案（组织管理员）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import {
  decideOrgProjectRule,
  listRulesSourcedFromProject,
} from "@/lib/projects/org-rules";
import { hasOrgRole } from "@/lib/rbac/roles";

async function canDecideOrgRules(input: {
  userId: string;
  userRole: string;
  orgId: string | null | undefined;
}) {
  if (input.userRole === "admin" || input.userRole === "super_admin") {
    return true;
  }
  if (!input.orgId) return false;
  const membership = await db.organizationMember.findFirst({
    where: {
      orgId: input.orgId,
      userId: input.userId,
      status: "active",
    },
    select: { role: true },
  });
  return !!membership && hasOrgRole(membership.role, "org_admin");
}

export const GET = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  const rules = await listRulesSourcedFromProject(projectId);
  const canDecide = await canDecideOrgRules({
    userId: user.id,
    userRole: user.role ?? "user",
    orgId: project?.orgId,
  });

  return NextResponse.json({
    projectId,
    orgId: project?.orgId ?? null,
    canDecide,
    rules,
  });
});

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project?.orgId) {
    return NextResponse.json({ error: "项目未归属组织" }, { status: 400 });
  }

  const allowed = await canDecideOrgRules({
    userId: user.id,
    userRole: user.role ?? "user",
    orgId: project.orgId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "仅组织管理员可确认规则" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (
    body.action === "decide" &&
    typeof body.ruleId === "string" &&
    (body.decision === "activate" ||
      body.decision === "reject" ||
      body.decision === "archive")
  ) {
    const owned = await db.organizationProjectRule.findFirst({
      where: {
        id: body.ruleId,
        orgId: project.orgId,
        sourceProjectId: projectId,
      },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "规则不存在或不属于本项目" }, { status: 404 });
    }

    const rule = await decideOrgProjectRule({
      ruleId: body.ruleId,
      orgId: project.orgId,
      userId: user.id,
      decision: body.decision,
    });
    return NextResponse.json({ rule });
  }

  return NextResponse.json({ error: "action 无效" }, { status: 400 });
});
