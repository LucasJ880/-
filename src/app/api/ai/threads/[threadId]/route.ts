import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  findOwnedThreadInOrg,
  resolveAssistantOrgId,
  threadNotFoundResponse,
} from "@/lib/assistant/thread-org";

export const GET = withAuth(async (request, ctx, user) => {
  const { threadId } = await ctx.params;
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
    userId: true,
    orgId: true,
    title: true,
    projectId: true,
    pinned: true,
    archived: true,
    lastMessageAt: true,
    createdAt: true,
    project: { select: { id: true, name: true } },
  });

  if (!thread) return threadNotFoundResponse();
  return NextResponse.json(thread);
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const { threadId } = await ctx.params;
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
  });
  if (!thread) return threadNotFoundResponse();

  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title.slice(0, 100);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  // 不允许通过普通 API 把线程改成「无 org」；归档允许
  if (typeof body.archived === "boolean") data.archived = body.archived;

  const updated = await db.aiThread.update({
    where: { id: threadId },
    data,
    select: {
      id: true,
      orgId: true,
      title: true,
      projectId: true,
      pinned: true,
      archived: true,
      lastMessageAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (request, ctx, user) => {
  const { threadId } = await ctx.params;
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
  });
  if (!thread) return threadNotFoundResponse();

  await db.aiThread.delete({ where: { id: threadId } });
  return NextResponse.json({ ok: true });
});
