import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  resolveAssistantOrgId,
  visibleThreadWhere,
} from "@/lib/assistant/thread-org";

const THREAD_SELECT = {
  id: true,
  title: true,
  orgId: true,
  projectId: true,
  pinned: true,
  lastMessageAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
  _count: { select: { messages: true } },
} as const;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = {
    ...visibleThreadWhere(user.id, orgRes.orgId),
  };
  if (projectId) where.projectId = projectId;

  const threads = await db.aiThread.findMany({
    where,
    select: THREAD_SELECT,
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(threads);
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = (await request.json().catch(() => ({}))) as {
    projectId?: unknown;
    title?: unknown;
    orgId?: unknown;
  };
  const claimedBodyOrgId =
    typeof body.orgId === "string" ? body.orgId.trim() : null;

  const orgRes = await resolveAssistantOrgId(request, user, claimedBodyOrgId);
  if (!orgRes.ok) return orgRes.response;

  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;

  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, orgId: orgRes.orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
  }

  const thread = await db.aiThread.create({
    data: {
      userId: user.id,
      orgId: orgRes.orgId,
      projectId,
      title:
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, 100)
          : "新对话",
    },
    select: THREAD_SELECT,
  });

  if (!thread.orgId) {
    // 不应发生：应用层强制非空
    await db.aiThread.delete({ where: { id: thread.id } }).catch(() => {});
    return NextResponse.json(
      { error: "创建对话失败：缺少组织上下文", code: "TENANT_CONTEXT_REQUIRED" },
      { status: 500 },
    );
  }

  return NextResponse.json(thread, { status: 201 });
});
