import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canViewProjectDiscussion,
  canPostProjectMessage,
} from "@/lib/project-discussion/access";
import { sendMessage, loadOlderMessages } from "@/lib/project-discussion/service";
import { MESSAGE_MAX_LENGTH } from "@/lib/project-discussion/types";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/[id]/discussion/messages?cursor=...
 * 加载更早的消息（向上翻页）
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { id: projectId } = await ctx.params;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

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

  const result = await loadOlderMessages(projectId, cursor, pageSize);
  return NextResponse.json(result);
}

/**
 * POST /api/projects/[id]/discussion/messages
 * 发送文本消息
 */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { id: projectId } = await ctx.params;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const canPost = await canPostProjectMessage(user, projectId);
  if (!canPost) {
    return NextResponse.json({ error: "无权在此项目发送消息" }, { status: 403 });
  }

  let body: { body?: unknown; replyToId?: unknown };
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

  try {
    const message = await sendMessage(
      projectId,
      user.id,
      body.body,
      replyToId
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "发送失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
