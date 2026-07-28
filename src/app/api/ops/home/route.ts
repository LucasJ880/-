/**
 * GET /api/ops/home
 * 运营中心首页只读聚合
 *
 * Query:
 *   view=mine|team  — team 仅管理工作区用户可用
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { buildOpsDashboard } from "@/lib/operations/dashboard";
import {
  canAccessOperationsWorkspace,
} from "@/lib/rbac/workspace-policy";
import {
  canViewTeamTasks,
  type OpsAccessContext,
} from "@/lib/operations/projects";

export const GET = withAuth(async (request, _ctx, user) => {
  const resolved = await resolvePreferredOrgId(user.id, user.role);
  if (!resolved.orgId) {
    return NextResponse.json(
      { error: "请先选择企业", code: "ORG_REQUIRED" },
      { status: 400 },
    );
  }

  const member = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: resolved.orgId, userId: user.id },
    },
    select: { role: true, status: true },
  });
  const orgRole =
    member?.status === "active" ? member.role : null;

  const wsCtx = {
    platformRole: user.role,
    orgRole,
    hasMembership: Boolean(orgRole),
    enabledModules: null as string[] | null,
  };
  const opsCtx: OpsAccessContext = {
    ...wsCtx,
    userId: user.id,
  };

  if (!canAccessOperationsWorkspace(wsCtx)) {
    return NextResponse.json(
      { error: "无权访问运营中心", code: "OPS_FORBIDDEN" },
      { status: 403 },
    );
  }

  const canTeam = canViewTeamTasks(opsCtx);
  const viewParam = request.nextUrl.searchParams.get("view");
  const wantTeam = viewParam === "team";
  const ownOnly = canTeam ? !wantTeam : true;

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { name: true },
  });

  const data = await buildOpsDashboard({
    userId: user.id,
    userName: dbUser?.name || user.name || "运营",
    userRole: user.role,
    orgId: resolved.orgId,
    ownOnly,
    canToggleTeamView: canTeam,
    opsCtx,
  });

  return NextResponse.json(data);
});
