import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { getRecentProjectActivity } from "@/lib/activity/query";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const { project } = access;

  const [counts, recentActivity] = await Promise.all([
    db.project.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            tasks: true,
            members: true,
            environments: true,
            prompts: true,
            knowledgeBases: true,
            conversations: true,
            agents: true,
          },
        },
      },
    }),
    getRecentProjectActivity(id, 8),
  ]);

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    counts: counts?._count ?? {},
    recentActivity,
  });
}
