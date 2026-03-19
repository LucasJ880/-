import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import {
  sortSnapshots,
  createNextKnowledgeBaseVersion,
} from "@/lib/knowledge-bases/snapshot";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; kbId: string }> };

/**
 * test 环境 KB 的当前 active 版本快照 → prod 同 key（新建或追加版本）
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));
  const targetCode =
    typeof body.targetEnvironmentCode === "string"
      ? body.targetEnvironmentCode.trim().toLowerCase()
      : "prod";
  if (targetCode !== "prod") {
    return NextResponse.json(
      { error: "当前仅支持发布到 prod 环境" },
      { status: 400 }
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  try {
    const result = await db.$transaction(async (tx) => {
      const src = await tx.knowledgeBase.findFirst({
        where: { id: kbId, projectId },
        include: {
          environment: true,
          activeVersion: true,
        },
      });

      if (!src) {
        throw new Error("KB_NOT_FOUND");
      }
      if (src.environment.code !== "test") {
        throw new Error("SOURCE_NOT_TEST");
      }
      if (!src.activeVersionId || !src.activeVersion) {
        throw new Error("NO_ACTIVE_VERSION");
      }

      const prodEnv = await tx.environment.findFirst({
        where: { projectId, code: "prod" },
      });
      if (!prodEnv) {
        throw new Error("NO_PROD_ENV");
      }

      const srcKbv = src.activeVersion;
      const testSnaps = sortSnapshots(
        await tx.knowledgeDocumentVersion.findMany({
          where: { knowledgeBaseVersionId: srcKbv.id },
          include: { document: true },
        })
      );

      let prodKb = await tx.knowledgeBase.findUnique({
        where: {
          projectId_environmentId_key: {
            projectId,
            environmentId: prodEnv.id,
            key: src.key,
          },
        },
      });

      if (!prodKb) {
        prodKb = await tx.knowledgeBase.create({
          data: {
            projectId,
            environmentId: prodEnv.id,
            key: src.key,
            name: src.name,
            description: src.description,
            status: "active",
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }

      const previousProdActiveKbvId = prodKb.activeVersionId;

      const newProdKbv = await createNextKnowledgeBaseVersion(tx, {
        knowledgeBaseId: prodKb.id,
        userId: user.id,
        note: note ?? `自 test v${srcKbv.version} 发布`,
        sourceKbVersionId: srcKbv.id,
      });

      const matchedProdDocIds = new Set<string>();

      for (const snap of testSnaps) {
        const tdoc = snap.document;
        let prodDoc = await tx.knowledgeDocument.findFirst({
          where: {
            knowledgeBaseId: prodKb.id,
            title: tdoc.title,
            sourceType: tdoc.sourceType,
          },
        });

        if (!prodDoc) {
          prodDoc = await tx.knowledgeDocument.create({
            data: {
              knowledgeBaseId: prodKb.id,
              environmentId: prodEnv.id,
              title: tdoc.title,
              sourceType: tdoc.sourceType,
              sourceUrl: tdoc.sourceUrl,
              status: tdoc.status,
              sortOrder: tdoc.sortOrder,
              createdById: user.id,
              updatedById: user.id,
            },
          });
        } else {
          await tx.knowledgeDocument.update({
            where: { id: prodDoc.id },
            data: {
              sourceUrl: tdoc.sourceUrl,
              sortOrder: tdoc.sortOrder,
              status: tdoc.status,
              updatedById: user.id,
            },
          });
        }

        matchedProdDocIds.add(prodDoc.id);

        const maxDocV = await tx.knowledgeDocumentVersion.aggregate({
          where: { documentId: prodDoc.id },
          _max: { version: true },
        });
        const nextDocV = (maxDocV._max.version ?? 0) + 1;

        await tx.knowledgeDocumentVersion.create({
          data: {
            documentId: prodDoc.id,
            knowledgeBaseVersionId: newProdKbv.id,
            version: nextDocV,
            content: snap.content,
            summary: snap.summary,
            note: snap.note,
            sourceVersionId: snap.id,
            createdById: user.id,
          },
        });
      }

      if (previousProdActiveKbvId) {
        const oldProdSnaps = await tx.knowledgeDocumentVersion.findMany({
          where: { knowledgeBaseVersionId: previousProdActiveKbvId },
        });
        for (const old of oldProdSnaps) {
          if (matchedProdDocIds.has(old.documentId)) continue;
          await tx.knowledgeDocumentVersion.create({
            data: {
              documentId: old.documentId,
              knowledgeBaseVersionId: newProdKbv.id,
              version: old.version,
              content: old.content,
              summary: old.summary,
              note: old.note,
              sourceVersionId: old.sourceVersionId,
              createdById: user.id,
            },
          });
        }
      }

      await tx.knowledgeBase.update({
        where: { id: prodKb.id },
        data: {
          activeVersionId: newProdKbv.id,
          name: src.name,
          description: src.description,
          updatedById: user.id,
        },
      });

      await tx.knowledgePublishLog.create({
        data: {
          projectId,
          knowledgeBaseKey: src.key,
          fromEnvironmentId: src.environmentId,
          toEnvironmentId: prodEnv.id,
          fromKnowledgeBaseVersionId: srcKbv.id,
          toKnowledgeBaseVersionId: newProdKbv.id,
          publishedById: user.id,
          note,
        },
      });

      return {
        knowledgeBaseKey: src.key,
        sourceKnowledgeBaseId: src.id,
        sourceEnvironmentCode: src.environment.code,
        sourceKbVersion: {
          id: srcKbv.id,
          version: srcKbv.version,
        },
        targetKnowledgeBaseId: prodKb.id,
        targetKbVersion: {
          id: newProdKbv.id,
          version: newProdKbv.version,
        },
      };
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.UPDATE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_BASE,
      targetId: kbId,
      afterData: {
        action: "publish_test_to_prod",
        knowledgeBaseKey: result.knowledgeBaseKey,
        fromKbVersionId: result.sourceKbVersion.id,
        toKbVersionId: result.targetKbVersion.id,
        targetKnowledgeBaseId: result.targetKnowledgeBaseId,
      },
      request,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const map: Record<string, { status: number; error: string }> = {
      KB_NOT_FOUND: { status: 404, error: "知识库不存在" },
      SOURCE_NOT_TEST: {
        status: 400,
        error: "仅支持从 test 环境的知识库发布到 prod",
      },
      NO_ACTIVE_VERSION: { status: 400, error: "源知识库没有生效版本" },
      NO_PROD_ENV: {
        status: 400,
        error: "项目中不存在 prod 环境，请先创建",
      },
    };
    const m = map[code];
    if (m) {
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    console.error("[kb publish]", e);
    return NextResponse.json({ error: "发布失败" }, { status: 500 });
  }
}
