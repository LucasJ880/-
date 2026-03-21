import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isValidDocStatus } from "@/lib/knowledge-bases/validation";
import {
  createNextKnowledgeBaseVersion,
  cloneDocumentSnapshotsToNewKbVersion,
  getNextDocumentVersionNumber,
} from "@/lib/knowledge-bases/snapshot";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; kbId: string; docId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, docId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const doc = await db.knowledgeDocument.findFirst({
    where: { id: docId, knowledgeBaseId: kbId },
    include: {
      knowledgeBase: {
        select: {
          id: true,
          key: true,
          name: true,
          projectId: true,
          activeVersionId: true,
          environment: { select: { id: true, code: true, name: true } },
        },
      },
      updatedBy: { select: { id: true, name: true } },
    },
  });

  if (!doc || doc.knowledgeBase.projectId !== projectId) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  let activeSnapshot: {
    id: string;
    version: number;
    content: string;
    summary: string | null;
    note: string | null;
    createdAt: Date;
  } | null = null;

  if (doc.knowledgeBase.activeVersionId) {
    const snap = await db.knowledgeDocumentVersion.findUnique({
      where: {
        documentId_knowledgeBaseVersionId: {
          documentId: docId,
          knowledgeBaseVersionId: doc.knowledgeBase.activeVersionId,
        },
      },
    });
    if (snap) {
      activeSnapshot = {
        id: snap.id,
        version: snap.version,
        content: snap.content,
        summary: snap.summary,
        note: snap.note,
        createdAt: snap.createdAt,
      };
    }
  }

  const recentVersions = await db.knowledgeDocumentVersion.findMany({
    where: { documentId: docId },
    orderBy: { version: "desc" },
    take: 20,
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdById: true,
      knowledgeBaseVersionId: true,
    },
  });

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      sourceUrl: doc.sourceUrl,
      status: doc.status,
      sortOrder: doc.sortOrder,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      updatedBy: doc.updatedBy,
      knowledgeBase: doc.knowledgeBase,
    },
    activeSnapshot,
    recentVersions,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId, docId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const doc = await db.knowledgeDocument.findFirst({
    where: { id: docId, knowledgeBaseId: kbId },
    include: {
      knowledgeBase: true,
    },
  });
  if (!doc || doc.knowledgeBase.projectId !== projectId) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const kb = doc.knowledgeBase;
  if (!kb.activeVersionId) {
    return NextResponse.json({ error: "知识库缺少生效版本" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  const curSnap = await db.knowledgeDocumentVersion.findUnique({
    where: {
      documentId_knowledgeBaseVersionId: {
        documentId: docId,
        knowledgeBaseVersionId: kb.activeVersionId,
      },
    },
  });

  const newTitle =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : doc.title;
  const newSourceUrl =
    body.sourceUrl === null
      ? null
      : typeof body.sourceUrl === "string"
        ? body.sourceUrl.trim() || null
        : doc.sourceUrl;
  let newStatus = doc.status;
  if (typeof body.status === "string" && body.status.trim()) {
    const st = body.status.trim();
    if (!isValidDocStatus(st)) {
      return NextResponse.json({ error: "无效的 status" }, { status: 400 });
    }
    newStatus = st;
  }

  const newContent =
    typeof body.content === "string" ? body.content : (curSnap?.content ?? "");
  const newSummary =
    body.summary === null
      ? null
      : typeof body.summary === "string"
        ? body.summary.trim() || null
        : curSnap?.summary ?? null;

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  const contentOrSummaryChanged =
    curSnap !== null &&
    (newContent !== curSnap.content || newSummary !== curSnap.summary);

  const becomingArchived =
    newStatus === "archived" && doc.status !== "archived";

  const needKbBump = contentOrSummaryChanged || becomingArchived;

  const before = {
    title: doc.title,
    status: doc.status,
    contentPreview: curSnap?.content?.slice(0, 120) ?? "",
  };

  try {
    await db.$transaction(async (tx) => {
      if (needKbBump) {
        const oldKbvId = kb.activeVersionId!;
        const newKbv = await createNextKnowledgeBaseVersion(tx, {
          knowledgeBaseId: kbId,
          userId: user.id,
          note:
            note ??
            (becomingArchived
              ? "归档文档"
              : contentOrSummaryChanged
                ? "更新文档内容"
                : null),
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

        if (contentOrSummaryChanged && curSnap) {
          const nextV = await getNextDocumentVersionNumber(tx, docId);
          overrides.set(docId, {
            version: nextV,
            content: newContent,
            summary: newSummary,
            note: note ?? curSnap.note,
            sourceVersionId: curSnap.id,
          });
        }

        await cloneDocumentSnapshotsToNewKbVersion(
          tx,
          oldKbvId,
          newKbv.id,
          user.id,
          overrides
        );

        await tx.knowledgeBase.update({
          where: { id: kbId },
          data: { activeVersionId: newKbv.id, updatedById: user.id },
        });
      }

      await tx.knowledgeDocument.update({
        where: { id: docId },
        data: {
          title: newTitle,
          sourceUrl: newSourceUrl,
          status: newStatus,
          updatedById: user.id,
        },
      });
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.UPDATE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_DOCUMENT,
      targetId: docId,
      beforeData: {
        ...before,
        knowledgeBaseId: kbId,
        kbKey: kb.key,
        environmentId: kb.environmentId,
      },
      afterData: {
        title: newTitle,
        status: newStatus,
        kbBumped: needKbBump,
        environmentId: kb.environmentId,
        kbKey: kb.key,
      },
      request,
    });

    const fresh = await db.knowledgeDocument.findUnique({
      where: { id: docId },
      include: {
        knowledgeBase: {
          include: { activeVersion: { select: { id: true, version: true } } },
        },
      },
    });

    return NextResponse.json({ document: fresh });
  } catch (e) {
    console.error("[KB document patch]", e);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
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

  if (doc.status === "archived") {
    return NextResponse.json({ ok: true, document: doc });
  }

  const kb = doc.knowledgeBase;
  if (!kb.activeVersionId) {
    return NextResponse.json({ error: "知识库缺少生效版本" }, { status: 400 });
  }

  try {
    await db.$transaction(async (tx) => {
      const oldKbvId = kb.activeVersionId!;
      const newKbv = await createNextKnowledgeBaseVersion(tx, {
        knowledgeBaseId: kbId,
        userId: user.id,
        note: "归档文档（删除）",
      });
      await cloneDocumentSnapshotsToNewKbVersion(
        tx,
        oldKbvId,
        newKbv.id,
        user.id,
        new Map()
      );
      await tx.knowledgeBase.update({
        where: { id: kbId },
        data: { activeVersionId: newKbv.id, updatedById: user.id },
      });
      await tx.knowledgeDocument.update({
        where: { id: docId },
        data: { status: "archived", updatedById: user.id },
      });
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.STATUS_CHANGE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_DOCUMENT,
      targetId: docId,
      afterData: {
        status: "archived",
        knowledgeBaseId: kbId,
        kbKey: kb.key,
        environmentId: kb.environmentId,
      },
      request,
    });

    const fresh = await db.knowledgeDocument.findUnique({
      where: { id: docId },
    });
    return NextResponse.json({ ok: true, document: fresh });
  } catch (e) {
    console.error("[KB document delete]", e);
    return NextResponse.json({ error: "归档失败" }, { status: 500 });
  }
}
