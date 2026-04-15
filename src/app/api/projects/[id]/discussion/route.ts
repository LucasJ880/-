import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { canViewProjectDiscussion } from "@/lib/project-discussion/access";
import { getDiscussionOverview } from "@/lib/project-discussion/service";

/**
 * GET /api/projects/[id]/discussion
 * 获取项目讨论概览：会话信息 + 最新消息 + 统计
 */
export const GET = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const canView = await canViewProjectDiscussion(user, projectId);
  if (!canView) {
    return NextResponse.json({ error: "无权查看该项目讨论" }, { status: 403 });
  }

  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const pageSizeStr = request.nextUrl.searchParams.get("pageSize");
  const pageSize = pageSizeStr ? Math.min(Math.max(parseInt(pageSizeStr, 10), 1), 100) : undefined;

  const overview = await getDiscussionOverview(projectId, { pageSize, cursor });

  return NextResponse.json(overview);
});
