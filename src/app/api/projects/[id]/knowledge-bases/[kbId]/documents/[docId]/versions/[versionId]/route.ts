import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = {
  params: Promise<{
    id: string;
    kbId: string;
    docId: string;
    versionId: string;
  }>;
};

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, docId, versionId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const ver = await db.knowledgeDocumentVersion.findFirst({
    where: { id: versionId, documentId: docId },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          knowledgeBaseId: true,
          knowledgeBase: { select: { projectId: true, key: true } },
        },
      },
    },
  });

  if (
    !ver ||
    ver.document.knowledgeBaseId !== kbId ||
    ver.document.knowledgeBase.projectId !== projectId
  ) {
    return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  }

  return NextResponse.json({
    version: {
      id: ver.id,
      documentId: ver.documentId,
      version: ver.version,
      content: ver.content,
      summary: ver.summary,
      note: ver.note,
      createdAt: ver.createdAt,
      createdById: ver.createdById,
      knowledgeBaseVersionId: ver.knowledgeBaseVersionId,
    },
    document: {
      id: ver.document.id,
      title: ver.document.title,
      kbKey: ver.document.knowledgeBase.key,
    },
  });
}
