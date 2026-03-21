import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/audit-logs/[id]
 * 审计日志详情（含 beforeData / afterData）
 * 权限收敛：必须验证该日志的 orgId/projectId 归属
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const log = await db.auditLog.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!log) {
    return NextResponse.json({ error: "审计日志不存在" }, { status: 404 });
  }

  // ---- 权限校验 ----

  if (!isSuperAdmin(user.role)) {
    // 必须与该日志的 orgId 有关联
    if (!log.orgId) {
      return NextResponse.json({ error: "无权查看该审计日志" }, { status: 403 });
    }

    const membership = await getOrgMembership(user.id, log.orgId);
    if (!membership || membership.status !== "active") {
      return NextResponse.json({ error: "无权查看该审计日志" }, { status: 403 });
    }

    // org_admin 可查看组织内所有日志
    if (!hasOrgRole(membership.role, "org_admin")) {
      // 非 org_admin 需要是该项目的 project_admin
      if (!log.projectId) {
        return NextResponse.json(
          { error: "需要组织管理员权限查看此日志" },
          { status: 403 }
        );
      }
      const pm = await getProjectMembership(user.id, log.projectId);
      if (!pm || pm.status !== "active" || pm.role !== "project_admin") {
        return NextResponse.json(
          { error: "需要项目管理员权限查看此日志" },
          { status: 403 }
        );
      }
    }
  }

  return NextResponse.json({
    log: {
      id: log.id,
      orgId: log.orgId,
      projectId: log.projectId,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      beforeData: log.beforeData ? JSON.parse(log.beforeData) : null,
      afterData: log.afterData ? JSON.parse(log.afterData) : null,
      ip: log.ip,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
      user: log.user,
    },
  });
}
