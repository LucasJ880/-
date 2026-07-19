import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const insights = await db.projectInsight.findMany({
    where: {
      projectId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ insights });
});

export const POST = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "other";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title || !content) {
    return NextResponse.json({ error: "title/content 必填" }, { status: 400 });
  }

  const insight = await db.projectInsight.create({
    data: {
      orgId: access.project.orgId,
      projectId,
      kind,
      title,
      content,
      source: typeof body.source === "string" ? body.source : "system",
      status: "draft",
    },
  });
  return NextResponse.json({ insight });
});
