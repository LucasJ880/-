import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { myTasksWhere } from "@/lib/tasks/access";
import { visibleProjectsWhere } from "@/lib/projects/visibility";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ tasks: [], projects: [] });
  }

  const visibleProjects = await visibleProjectsWhere(user);

  const [tasks, projects] = await Promise.all([
    db.task.findMany({
      where: {
        AND: [
          myTasksWhere(user.id),
          {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
            ],
          },
        ],
      },
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
      where: {
        AND: [
          visibleProjects,
          {
            OR: [
              { name: { contains: q } },
              { description: { contains: q } },
            ],
          },
        ],
      },
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
}
