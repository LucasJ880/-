import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  canViewProjectDiscussion,
  canPostProjectMessage,
} from "@/lib/project-discussion/access";
import {
  sendMessage,
  sendMentionMessageOnce,
  loadOlderMessages,
  type SendMessageResult,
} from "@/lib/project-discussion/service";
import { MESSAGE_MAX_LENGTH, type MentionItem } from "@/lib/project-discussion/types";
import { db } from "@/lib/db";
import { deliverCollabNotification } from "@/lib/notifications/collab/deliver";
import {
  MENTION_NOT_ALLOWED_ERROR,
  buildMentionMetadata,
  checkMentionRecipients,
  discussionMentionEvent,
  loadMentionUsers,
  parseMentionList,
} from "@/lib/notifications/collab/mentions";
import { defaultRecipientDeps } from "@/lib/notifications/collab/recipients";
import { isPreviewReadonly } from "@/lib/preview/server";

/**
 * GET /api/projects/[id]/discussion/messages?cursor=...
 * 加载更早的消息（向上翻页）
 */
export const GET = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const canView = await canViewProjectDiscussion(user, projectId);
  if (!canView) {
    return NextResponse.json({ error: "无权查看该项目讨论" }, { status: 403 });
  }

  const cursor = request.nextUrl.searchParams.get("cursor");
  if (!cursor) {
    return NextResponse.json({ error: "缺少 cursor 参数" }, { status: 400 });
  }

  const pageSizeStr = request.nextUrl.searchParams.get("pageSize");
  const pageSize = pageSizeStr
    ? Math.min(Math.max(parseInt(pageSizeStr, 10), 1), 100)
    : undefined;

  const result = await loadOlderMessages(projectId, cursor, pageSize, { create: !(await isPreviewReadonly(user.id)) });
  return NextResponse.json(result);
});

/**
 * POST /api/projects/[id]/discussion/messages
 * 发送文本消息
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const canPost = await canPostProjectMessage(user, projectId);
  if (!canPost) {
    return NextResponse.json({ error: "无权在此项目发送消息" }, { status: 403 });
  }

  let body: { body?: unknown; replyToId?: unknown; mentions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
  }

  if (body.body.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `消息长度不能超过 ${MESSAGE_MAX_LENGTH} 字` },
      { status: 400 }
    );
  }

  const replyToId =
    typeof body.replyToId === "string" ? body.replyToId : undefined;

  // COLLAB-2：校验 @ 名单与被 @ 的人（design D3）；不带 @ 时与之前相同
  const parsed = parseMentionList(body.mentions);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, code: "MENTION_INVALID" }, { status: 400 });
  }
  let mentionItems: MentionItem[] = [];
  let project: { name: string; orgId: string | null } | null = null;
  if (parsed.mentions.length > 0) {
    project = await db.project.findUnique({
      where: { id: projectId },
      select: { name: true, orgId: true },
    });
    const check = await checkMentionRecipients(
      parsed.mentions.map((m) => m.userId),
      { actorId: user.id, orgId: project?.orgId ?? null },
      {
        loadUsers: loadMentionUsers,
        findActiveMemberIds: defaultRecipientDeps.findActiveMemberIds,
        canView: (u) => canViewProjectDiscussion(u, projectId),
      },
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: MENTION_NOT_ALLOWED_ERROR, code: "MENTION_NOT_ALLOWED", invalidUserIds: check.invalidUserIds },
        { status: 400 },
      );
    }
    mentionItems = buildMentionMetadata(parsed.mentions, check.names);
  }

  let result: SendMessageResult;
  try {
    result = mentionItems.length
      ? await sendMentionMessageOnce(projectId, user.id, body.body, replyToId, { mentions: mentionItems })
      : { message: await sendMessage(projectId, user.id, body.body, replyToId), replayed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "发送失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 10 分钟内重发：返回第一次创建的那条，不再通知（design D4）
  if (result.replayed) {
    return NextResponse.json({ message: result.message, replayed: true }, { status: 200 });
  }

  // 创建成功之后通知被 @ 的人；入口不向外抛错，失败只记日志（design D1）
  if (mentionItems.length > 0) {
    await deliverCollabNotification(discussionMentionEvent({
      messageId: result.message.id,
      projectId,
      projectName: project?.name ?? "",
      orgId: project?.orgId ?? null,
      actorId: user.id,
      actorName: user.name,
      body: result.message.body,
      mentionIds: mentionItems.map((m) => m.userId),
    }));
  }

  return NextResponse.json({ message: result.message }, { status: 201 });
});
