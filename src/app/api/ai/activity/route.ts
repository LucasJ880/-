import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

const AI_ACTIONS = ["ai_generate", "ai_send", "ai_analyze"];

const PAGE_SIZE = 30;

/**
 * GET /api/ai/activity
 *
 * 返回当前用户的 AI 操作历史（分页），
 * 包括自动创建的任务和 AI 生成/发送/分析的记录。
 *
 * Query: ?cursor=<lastId>&projectId=<optional>
 */
export const GET = withAuth(async (request, ctx, user) => {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = {
    userId: user.id,
    action: { in: AI_ACTIONS },
  };
  if (projectId) where.projectId = projectId;

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      projectId: true,
      afterData: true,
      createdAt: true,
    },
  });

  const hasMore = logs.length > PAGE_SIZE;
  const items = hasMore ? logs.slice(0, PAGE_SIZE) : logs;

  const projectIds = [...new Set(items.map((l) => l.projectId).filter(Boolean))] as string[];
  const projects =
    projectIds.length > 0
      ? await db.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
      : [];
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const formatted = items.map((log) => {
    let detail = "";
    try {
      const data = log.afterData ? JSON.parse(log.afterData as string) : {};
      detail =
        data.subject || data.title || data.supplier || data.type || "";
    } catch { /* skip */ }

    return {
      id: log.id,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      projectId: log.projectId,
      projectName: log.projectId ? projectMap.get(log.projectId) ?? null : null,
      detail,
      createdAt: log.createdAt.toISOString(),
    };
  });

  return NextResponse.json({
    items: formatted,
    hasMore,
    nextCursor: items.length > 0 ? items[items.length - 1].id : null,
  });
});
