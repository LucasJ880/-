import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; kbId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const kb = await db.knowledgeBase.findFirst({
    where: { id: kbId, projectId },
    select: { id: true },
  });
  if (!kb) {
    return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  }

  const versions = await db.knowledgeBaseVersion.findMany({
    where: { knowledgeBaseId: kbId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ versions });
}
