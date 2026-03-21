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

  const { searchParams } = new URL(request.url);
  const fromId = searchParams.get("fromVersionId")?.trim();
  const toId = searchParams.get("toVersionId")?.trim();

  if (!fromId || !toId) {
    return NextResponse.json(
      { error: "需要 fromVersionId 和 toVersionId 参数" },
      { status: 400 }
    );
  }

  const [fromVersion, toVersion] = await Promise.all([
    db.promptVersion.findFirst({
      where: { id: fromId, promptId },
      select: {
        id: true,
        version: true,
        content: true,
        note: true,
        createdAt: true,
        createdById: true,
      },
    }),
    db.promptVersion.findFirst({
      where: { id: toId, promptId },
      select: {
        id: true,
        version: true,
        content: true,
        note: true,
        createdAt: true,
        createdById: true,
      },
    }),
  ]);

  if (!fromVersion) {
    return NextResponse.json(
      { error: "fromVersionId 对应的版本不存在" },
      { status: 404 }
    );
  }
  if (!toVersion) {
    return NextResponse.json(
      { error: "toVersionId 对应的版本不存在" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    from: fromVersion,
    to: toVersion,
  });
}
