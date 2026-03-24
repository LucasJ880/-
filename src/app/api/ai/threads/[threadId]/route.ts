import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { threadId } = await ctx.params;

  const thread = await db.aiThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      userId: true,
      title: true,
      projectId: true,
      pinned: true,
      archived: true,
      lastMessageAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  if (!thread || thread.userId !== user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json(thread);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { threadId } = await ctx.params;

  const thread = await db.aiThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title.slice(0, 100);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.archived === "boolean") data.archived = body.archived;

  const updated = await db.aiThread.update({
    where: { id: threadId },
    data,
    select: {
      id: true,
      title: true,
      projectId: true,
      pinned: true,
      archived: true,
      lastMessageAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { threadId } = await ctx.params;

  const thread = await db.aiThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  await db.aiThread.delete({ where: { id: threadId } });

  return NextResponse.json({ ok: true });
}
