import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { canUserViewTask } from "@/lib/tasks/access";
import {
  MENTION_NOT_ALLOWED_ERROR,
  MENTION_REPLAY_WINDOW_MS,
  checkMentionRecipients,
  findCommentReplay,
  loadMentionUsers,
  parseMentionList,
} from "@/lib/notifications/collab/mentions";
import { defaultRecipientDeps } from "@/lib/notifications/collab/recipients";
import { notifyTaskCommented } from "@/lib/notifications/collab/task-notify";

export const GET = withAuth(async (_request, ctx) => {
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

  // COLLAB-2：评论会通知负责人与创建人，只允许能查看该任务详情的人发表（design D5）
  const task = await db.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      dueDate: true,
      project: { select: { orgId: true } },
    },
  });
  if (!task || !(await canUserViewTask(user, task))) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const orgId = task.project?.orgId ?? null;

  const body = await request.json();

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "评论内容不能为空" }, { status: 400 });
  }
  const content: string = body.content.trim();

  // @ 名单与被 @ 的人在创建之前校验（design D3）
  const parsed = parseMentionList(body.mentions);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, code: "MENTION_INVALID" }, { status: 400 });
  }
  const mentionIds = parsed.mentions.map((m) => m.userId);
  if (mentionIds.length > 0) {
    const check = await checkMentionRecipients(
      mentionIds,
      { actorId: user.id, orgId },
      {
        loadUsers: loadMentionUsers,
        findActiveMemberIds: defaultRecipientDeps.findActiveMemberIds,
        canView: (u) => canUserViewTask(u, task),
      },
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: MENTION_NOT_ALLOWED_ERROR, code: "MENTION_NOT_ALLOWED", invalidUserIds: check.invalidUserIds },
        { status: 400 },
      );
    }
  }

  // 10 分钟内同一人向同一任务再发相同正文 → 返回第一次那条（design D4）；锁与查重在同一个事务里
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`task-comment:${user.id}:${id}:${content}`}))) AS l`;
    const recent = await tx.taskComment.findMany({
      where: {
        taskId: id,
        authorId: user.id,
        content,
        createdAt: { gte: new Date(now.getTime() - MENTION_REPLAY_WINDOW_MS) },
      },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    const replay = findCommentReplay(recent, { content }, now);
    if (replay) return { comment: replay, replayed: true };

    const comment = await tx.taskComment.create({
      data: { content, taskId: id, authorId: user.id },
      include: { author: { select: { id: true, name: true } } },
    });
    await tx.taskActivity.create({
      data: { action: "comment", detail: content, taskId: id, actorId: user.id },
    });
    if (mentionIds.length > 0) {
      await tx.taskActivity.create({
        data: {
          action: "comment.mentioned",
          detail: JSON.stringify({ commentId: comment.id, userIds: mentionIds }),
          taskId: id,
          actorId: user.id,
        },
      });
    }
    return { comment, replayed: false };
  });

  if (result.replayed) {
    return NextResponse.json({ ...result.comment, replayed: true }, { status: 200 });
  }

  // 提交之后通知：被 @ 的人收提及，负责人与创建人收评论（已被 @ 的除外）；不向外抛错（design D1）
  await notifyTaskCommented({
    task: { ...task, orgId },
    comment: result.comment,
    mentionIds,
    actor: user,
  });

  return NextResponse.json(result.comment, { status: 201 });
});
