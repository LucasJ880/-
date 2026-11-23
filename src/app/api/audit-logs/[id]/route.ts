import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveFinanceViewSafe } from "@/lib/project-finance/access";
import { redactAuditFinance } from "@/lib/audit/redact-finance";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/audit-logs/[id]
 * 审计日志详情（含 beforeData / afterData）
 * 权限收敛：必须验证该日志的 orgId/projectId 归属
 * FIX-26（FIX-25 安全审查 S1）：原有权限检查之后再判财务查看权（审计带项目时按该项目的负责人，不带项目时只认
 * 平台超级管理员与持组织范围财务键的人）。没有的人 beforeData / afterData 里成本、毛利、落地价类的键置 null，
 * 响应带 costHidden 与被置空的键路径；有的人返回与改动前逐字节相同。
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

  const beforeData: unknown = log.beforeData ? JSON.parse(log.beforeData) : null;
  const afterData: unknown = log.afterData ? JSON.parse(log.afterData) : null;
  const logBody = (before: unknown, after: unknown) => ({
    id: log.id,
    orgId: log.orgId,
    projectId: log.projectId,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    beforeData: before,
    afterData: after,
    ip: log.ip,
    userAgent: log.userAgent,
    createdAt: log.createdAt,
    user: log.user,
  });

  // ---- 财务查看权（FIX-26） ----
  const projectOwnerId = log.projectId
    ? (await db.project.findUnique({ where: { id: log.projectId }, select: { ownerId: true } }))?.ownerId ?? null
    : null;
  const finance = await resolveFinanceViewSafe(user, log.orgId, projectOwnerId);
  if (finance.canReadAll) {
    return NextResponse.json({ log: logBody(beforeData, afterData) });
  }

  const before = redactAuditFinance(beforeData, "beforeData");
  const after = redactAuditFinance(afterData, "afterData");
  const redactedPaths = [...before.paths, ...after.paths];
  return NextResponse.json({
    log: logBody(before.value, after.value),
    ...(redactedPaths.length > 0 ? { costHidden: true, redactedPaths } : {}),
  });
}
