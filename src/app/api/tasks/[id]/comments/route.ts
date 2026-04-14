import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (_request, ctx, _user) => {
  const { id } = await ctx.params;
  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(comments);
});

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
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
});
