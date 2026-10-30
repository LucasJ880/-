/**
 * GET /api/install/installers?orgId
 * INSTALL-1：当前企业持 install.task.read 的用户（id、姓名），供安排安装时选择。
 * 调用方须持 install.task.assign 或 install.task.read（ORG）。
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listUsersWithPermission } from "@/lib/sales/approvers";
import { installForbidden, resolveInstallScope } from "@/lib/install/service";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  const [assign, read] = await Promise.all([
    resolveInstallScope(user, orgId, "install.task.assign"),
    resolveInstallScope(user, orgId),
  ]);
  if (!assign.decision.allowed && read.scope !== "org") return installForbidden();

  const ids = await listUsersWithPermission(orgId, "install.task.read");
  if (ids.length === 0) return NextResponse.json({ installers: [] });

  const users = await db.user.findMany({
    where: { id: { in: ids }, status: "active" },
    select: { id: true, name: true, nickname: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    installers: users.map((u) => ({ id: u.id, name: u.nickname || u.name })),
  });
});
