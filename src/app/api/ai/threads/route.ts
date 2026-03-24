import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}
