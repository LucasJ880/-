import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTaskAccess } from "@/lib/tasks/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;

  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(comments);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user } = access;

  const body = await request.json();

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "评论内容不能为空" }, { status: 400 });
  }

  const [comment] = await Promise.all([
    db.taskComment.create({
      data: { content: body.content.trim(), taskId: id, authorId: user.id },
      include: { author: { select: { id: true, name: true } } },
    }),
    db.taskActivity.create({
      data: { action: "comment", detail: body.content.trim(), taskId: id, actorId: user.id },
    }),
  ]);

  return NextResponse.json(comment, { status: 201 });
}
