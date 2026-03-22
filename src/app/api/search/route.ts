import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ tasks: [], projects: [] });
  }

  const projectWhere = await buildProjectVisibilityWhere(user);

  const projectFilter = projectWhere
    ? {
        AND: [
          projectWhere,
          { OR: [{ name: { contains: q } }, { description: { contains: q } }] },
        ],
      }
    : { OR: [{ name: { contains: q } }, { description: { contains: q } }] };

  const taskProjectScope = projectWhere
    ? {
        OR: [
          { project: projectWhere },
          { projectId: null, creatorId: user.id },
        ],
      }
    : {};

  const [tasks, projects] = await Promise.all([
    db.task.findMany({
      where: {
        ...taskProjectScope,
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
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
      where: projectFilter,
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
