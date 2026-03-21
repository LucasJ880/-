import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; kbId: string; versionId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, versionId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const kbv = await db.knowledgeBaseVersion.findFirst({
    where: { id: versionId, knowledgeBaseId: kbId },
    include: {
      knowledgeBase: { select: { id: true, projectId: true, key: true, name: true } },
    },
  });

  if (!kbv || kbv.knowledgeBase.projectId !== projectId) {
    return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  }

  const snaps = await db.knowledgeDocumentVersion.findMany({
    where: { knowledgeBaseVersionId: versionId },
    include: { document: true },
  });
  snaps.sort((a, b) => {
    if (a.document.sortOrder !== b.document.sortOrder) {
      return a.document.sortOrder - b.document.sortOrder;
    }
    return a.document.createdAt.getTime() - b.document.createdAt.getTime();
  });

  return NextResponse.json({
    knowledgeBaseVersion: {
      id: kbv.id,
      version: kbv.version,
      note: kbv.note,
      createdAt: kbv.createdAt,
      knowledgeBaseId: kbv.knowledgeBaseId,
      key: kbv.knowledgeBase.key,
      name: kbv.knowledgeBase.name,
    },
    documents: snaps.map((s) => ({
      document: {
        id: s.document.id,
        title: s.document.title,
        sourceType: s.document.sourceType,
        sourceUrl: s.document.sourceUrl,
        status: s.document.status,
        sortOrder: s.document.sortOrder,
      },
      snapshot: {
        id: s.id,
        version: s.version,
        content: s.content,
        summary: s.summary,
        note: s.note,
        createdAt: s.createdAt,
      },
    })),
  });
}
