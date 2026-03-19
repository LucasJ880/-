import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; promptId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const prompt = await db.prompt.findFirst({
    where: { id: promptId, projectId },
    select: { id: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const versions = await db.promptVersion.findMany({
    where: { promptId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdById: true,
      content: true,
    },
  });

  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      createdById: v.createdById,
      contentPreview:
        v.content.length > 200 ? `${v.content.slice(0, 200)}…` : v.content,
    })),
  });
}
