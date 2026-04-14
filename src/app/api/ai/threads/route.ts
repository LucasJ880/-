import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = {
    userId: user.id,
    archived: false,
  };
  if (projectId) where.projectId = projectId;

  const threads = await db.aiThread.findMany({
    where,
    select: {
      id: true,
      title: true,
      projectId: true,
      pinned: true,
      lastMessageAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(threads);
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { projectId, title } = body;

  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
  }

  const thread = await db.aiThread.create({
    data: {
      userId: user.id,
      projectId: projectId || null,
      title: title || "新对话",
    },
    select: {
      id: true,
      title: true,
      projectId: true,
      pinned: true,
      lastMessageAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(thread, { status: 201 });
});
