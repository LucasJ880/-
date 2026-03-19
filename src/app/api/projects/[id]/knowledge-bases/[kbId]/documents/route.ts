import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { isValidKbSourceType } from "@/lib/knowledge-bases/validation";
import {
  createNextKnowledgeBaseVersion,
  cloneDocumentSnapshotsToNewKbVersion,
} from "@/lib/knowledge-bases/snapshot";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; kbId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));

  const kb = await db.knowledgeBase.findFirst({
    where: { id: kbId, projectId },
  });
  if (!kb) {
    return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  }
  if (!kb.activeVersionId) {
    return NextResponse.json(
      { error: "知识库缺少生效版本，无法添加文档" },
      { status: 400 }
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  const sourceTypeRaw =
    typeof body.sourceType === "string" ? body.sourceType.trim() : "manual";
  if (!isValidKbSourceType(sourceTypeRaw)) {
    return NextResponse.json({ error: "无效的 sourceType" }, { status: 400 });
  }

  const sourceUrl =
    typeof body.sourceUrl === "string" && body.sourceUrl.trim()
      ? body.sourceUrl.trim()
      : null;
  if (sourceTypeRaw === "link" && !sourceUrl) {
    return NextResponse.json(
      { error: "link 类型需要填写 sourceUrl" },
      { status: 400 }
    );
  }

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

  const maxOrder = await db.knowledgeDocument.aggregate({
    where: { knowledgeBaseId: kbId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

  try {
    const doc = await db.$transaction(async (tx) => {
      const oldKbvId = kb.activeVersionId!;
      const newKbv = await createNextKnowledgeBaseVersion(tx, {
        knowledgeBaseId: kbId,
        userId: user.id,
        note: note ?? "新增文档",
      });
      await cloneDocumentSnapshotsToNewKbVersion(
        tx,
        oldKbvId,
        newKbv.id,
        user.id,
        new Map()
      );

      const d = await tx.knowledgeDocument.create({
        data: {
          knowledgeBaseId: kbId,
          environmentId: kb.environmentId,
          title,
          sourceType: sourceTypeRaw,
          sourceUrl,
          status: "active",
          sortOrder,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await tx.knowledgeDocumentVersion.create({
        data: {
          documentId: d.id,
          knowledgeBaseVersionId: newKbv.id,
          version: 1,
          content,
          summary,
          note,
          createdById: user.id,
        },
      });

      await tx.knowledgeBase.update({
        where: { id: kbId },
        data: { activeVersionId: newKbv.id, updatedById: user.id },
      });

      return d;
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.CREATE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_DOCUMENT,
      targetId: doc.id,
      afterData: {
        knowledgeBaseId: kbId,
        kbKey: kb.key,
        environmentId: kb.environmentId,
        title,
        sourceType: sourceTypeRaw,
        documentVersion: 1,
      },
      request,
    });

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    console.error("[KB document create]", e);
    return NextResponse.json({ error: "创建文档失败" }, { status: 500 });
  }
}
