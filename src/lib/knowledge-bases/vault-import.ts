/**
 * 项目知识库：批量导入 Markdown vault（单次 bump 一个 KB 版本）
 */

import { db } from "@/lib/db";
import {
  createNextKnowledgeBaseVersion,
  cloneDocumentSnapshotsToNewKbVersion,
} from "@/lib/knowledge-bases/snapshot";
import {
  extractTextFilesFromZip,
  parseVaultFiles,
  type VaultFileInput,
} from "@/lib/knowledge/markdown-vault-import";

export async function importVaultToProjectKnowledgeBase(input: {
  projectId: string;
  kbId: string;
  userId: string;
  files: VaultFileInput[];
  defaultCategory?: string;
}) {
  const kb = await db.knowledgeBase.findFirst({
    where: { id: input.kbId, projectId: input.projectId },
  });
  if (!kb) throw new Error("知识库不存在或不属于该项目");
  if (!kb.activeVersionId) throw new Error("知识库缺少生效版本，无法导入");

  const { documents, skipped } = parseVaultFiles(input.files, {
    defaultCategory: input.defaultCategory || "general",
    maxFiles: 100,
  });
  if (documents.length === 0) {
    return { created: 0, documents: [] as Array<{ id: string; title: string }>, skipped };
  }

  const maxOrder = await db.knowledgeDocument.aggregate({
    where: { knowledgeBaseId: input.kbId },
    _max: { sortOrder: true },
  });
  let sortOrder = maxOrder._max.sortOrder ?? 0;

  const created = await db.$transaction(async (tx) => {
    const oldKbvId = kb.activeVersionId!;
    const newKbv = await createNextKnowledgeBaseVersion(tx, {
      knowledgeBaseId: input.kbId,
      userId: input.userId,
      note: `Vault 导入 ${documents.length} 篇`,
    });
    await cloneDocumentSnapshotsToNewKbVersion(
      tx,
      oldKbvId,
      newKbv.id,
      input.userId,
      new Map(),
    );

    const rows: Array<{ id: string; title: string }> = [];
    for (const doc of documents) {
      sortOrder += 1;
      const d = await tx.knowledgeDocument.create({
        data: {
          knowledgeBaseId: input.kbId,
          environmentId: kb.environmentId,
          title: doc.title,
          sourceType: "vault_import",
          sourceUrl: doc.sourcePath,
          status: "active",
          sortOrder,
          createdById: input.userId,
          updatedById: input.userId,
        },
      });
      await tx.knowledgeDocumentVersion.create({
        data: {
          documentId: d.id,
          knowledgeBaseVersionId: newKbv.id,
          version: 1,
          content: `${doc.content}\n\n<!-- source: ${doc.sourcePath} -->`,
          summary: doc.category ? `category:${doc.category}` : null,
          note: "vault_import",
          createdById: input.userId,
        },
      });
      rows.push({ id: d.id, title: d.title });
    }

    await tx.knowledgeBase.update({
      where: { id: input.kbId },
      data: { activeVersionId: newKbv.id, updatedById: input.userId },
    });

    return rows;
  });

  return { created: created.length, documents: created, skipped };
}

export async function importZipToProjectKnowledgeBase(input: {
  projectId: string;
  kbId: string;
  userId: string;
  zip: Uint8Array;
  defaultCategory?: string;
}) {
  const files = extractTextFilesFromZip(input.zip);
  if (files.length === 0) {
    throw new Error("ZIP 中未找到 .md / .txt 文本文件");
  }
  return importVaultToProjectKnowledgeBase({
    projectId: input.projectId,
    kbId: input.kbId,
    userId: input.userId,
    files,
    defaultCategory: input.defaultCategory,
  });
}
