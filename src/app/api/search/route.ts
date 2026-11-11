import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import { buildProjectSearchWhere, buildTaskSearchWhere } from "@/lib/search/where";

export const GET = withAuth(async (request, _ctx, user) => {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ tasks: [], projects: [] });
  }

  const projectWhere = await buildProjectVisibilityWhere(user);

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
    db.project.findMany({
      where: buildProjectSearchWhere(projectWhere, q),
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
