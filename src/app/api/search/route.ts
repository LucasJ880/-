import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import {
  buildProjectSearchWhere,
  buildReadableProjectWhere,
  buildTaskSearchWhere,
  shouldSearchProjects,
  type SearchWhere,
} from "@/lib/search/where";
import { isOrgSystemAdmin, isSuperAdmin } from "@/lib/rbac/roles";
import { loadGateNavigationContextForUser } from "@/lib/navigation/page-context-server";

/**
 * VIS-1c：项目结果只给打得开的项目（spec search/global-search「项目结果的范围」）。
 * 平台 super_admin 不判定门、不加范围；其余用户项目详情门不放行时不搜项目（返回 null）。
 * 判定输入取路由门同一份（同一企业选择、30 秒缓存、不写库）：搜索每次输入都会请求。
 */
async function projectSearchWhereFor(user: { id: string; role: string }, q: string): Promise<SearchWhere | null> {
  if (isSuperAdmin(user.role)) return buildProjectSearchWhere(null, q);
  const ctx = await loadGateNavigationContextForUser(user.id);
  if (!shouldSearchProjects(ctx)) return null;
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true, role: true },
  });
  const adminOrgIds = memberships.filter((m) => isOrgSystemAdmin(m.role)).map((m) => m.orgId);
  return buildProjectSearchWhere(buildReadableProjectWhere(user.id, adminOrgIds), q);
}

export const GET = withAuth(async (request, _ctx, user) => {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ tasks: [], projects: [] });
  }

  // 任务范围不变：可见项目里的任务与本人的无项目任务
  const [projectWhere, projectSearch] = await Promise.all([
    buildProjectVisibilityWhere(user),
    projectSearchWhereFor(user, q),
  ]);

  const [tasks, projects] = await Promise.all([
    db.task.findMany({
      // 范围与关键词用 AND 组合（修复：之前展开范围后再写 OR 键，范围被覆盖，任务搜索跨企业泄露）
      where: buildTaskSearchWhere(projectWhere, user.id, q),
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        project: { select: { name: true, color: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    projectSearch === null
      ? Promise.resolve([])
      : db.project.findMany({
          where: projectSearch,
          select: {
            id: true,
            name: true,
            color: true,
            status: true,
            _count: { select: { tasks: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
  ]);

  return NextResponse.json({ tasks, projects });
});
