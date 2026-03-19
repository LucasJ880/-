import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = {
  params: Promise<{ id: string; promptId: string; versionId: string }>;
};

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId, versionId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const prompt = await db.prompt.findFirst({
    where: { id: promptId, projectId },
    select: { id: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const version = await db.promptVersion.findFirst({
    where: { id: versionId, promptId },
  });
  if (!version) {
    return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  }

  return NextResponse.json({
    version: {
      id: version.id,
      promptId: version.promptId,
      version: version.version,
      content: version.content,
      note: version.note,
      sourceVersionId: version.sourceVersionId,
      createdById: version.createdById,
      createdAt: version.createdAt,
    },
  });
}
