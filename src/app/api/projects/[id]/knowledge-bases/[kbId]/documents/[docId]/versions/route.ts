import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import {
  createNextKnowledgeBaseVersion,
  cloneDocumentSnapshotsToNewKbVersion,
  getNextDocumentVersionNumber,
} from "@/lib/knowledge-bases/snapshot";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = {
  params: Promise<{ id: string; kbId: string; docId: string }>;
};

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, docId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const doc = await db.knowledgeDocument.findFirst({
    where: { id: docId, knowledgeBaseId: kbId },
    include: { knowledgeBase: { select: { projectId: true } } },
  });
  if (!doc || doc.knowledgeBase.projectId !== projectId) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const versions = await db.knowledgeDocumentVersion.findMany({
    where: { documentId: docId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdById: true,
      knowledgeBaseVersionId: true,
    },
  });

  return NextResponse.json({ versions });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, docId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const doc = await db.knowledgeDocument.findFirst({
    where: { id: docId, knowledgeBaseId: kbId },
    include: { knowledgeBase: true },
  });
  if (!doc || doc.knowledgeBase.projectId !== projectId) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const kb = doc.knowledgeBase;
  if (!kb.activeVersionId) {
    return NextResponse.json(
      { error: "知识库缺少生效版本" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : doc.title;
  const content =
    typeof body.content === "string" ? body.content : "";
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : null;
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  try {
    const result = await db.$transaction(async (tx) => {
      const oldKbvId = kb.activeVersionId!;
      const nextDocV = await getNextDocumentVersionNumber(tx, docId);

      const newKbv = await createNextKnowledgeBaseVersion(tx, {
        knowledgeBaseId: kbId,
        userId: user.id,
        note: note ?? `文档「${title}」更新至 v${nextDocV}`,
      });

      const overrides = new Map<
        string,
        {
          version: number;
          content: string;
          summary: string | null;
          note: string | null;
          sourceVersionId: string | null;
        }
      >();
      overrides.set(docId, {
        version: nextDocV,
        content,
        summary,
        note,
        sourceVersionId: null,
      });

      await cloneDocumentSnapshotsToNewKbVersion(
        tx,
        oldKbvId,
        newKbv.id,
        user.id,
        overrides
      );

      await tx.knowledgeDocument.update({
        where: { id: docId },
        data: { title, updatedById: user.id },
      });

      await tx.knowledgeBase.update({
        where: { id: kbId },
        data: { activeVersionId: newKbv.id, updatedById: user.id },
      });

      return { kbVersion: newKbv.version, docVersion: nextDocV };
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.UPDATE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_DOCUMENT,
      targetId: docId,
      afterData: {
        knowledgeBaseId: kbId,
        kbKey: kb.key,
        environmentId: kb.environmentId,
        title,
        documentVersion: result.docVersion,
        kbVersion: result.kbVersion,
      },
      request,
    });

    return NextResponse.json(
      { ok: true, documentVersion: result.docVersion, kbVersion: result.kbVersion },
      { status: 201 }
    );
  } catch (e) {
    console.error("[KB doc version create]", e);
    return NextResponse.json({ error: "创建版本失败" }, { status: 500 });
  }
}
