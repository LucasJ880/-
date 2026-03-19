import type { Prisma } from "@prisma/client";

export type DbTx = Prisma.TransactionClient;

export async function createNextKnowledgeBaseVersion(
  tx: DbTx,
  params: {
    knowledgeBaseId: string;
    userId: string;
    note?: string | null;
    sourceKbVersionId?: string | null;
  }
) {
  const max = await tx.knowledgeBaseVersion.aggregate({
    where: { knowledgeBaseId: params.knowledgeBaseId },
    _max: { version: true },
  });
  const next = (max._max.version ?? 0) + 1;
  return tx.knowledgeBaseVersion.create({
    data: {
      knowledgeBaseId: params.knowledgeBaseId,
      version: next,
      note: params.note ?? null,
      sourceVersionId: params.sourceKbVersionId ?? null,
      createdById: params.userId,
    },
  });
}

export async function getNextDocumentVersionNumber(
  tx: DbTx,
  documentId: string
): Promise<number> {
  const max = await tx.knowledgeDocumentVersion.aggregate({
    where: { documentId },
    _max: { version: true },
  });
  return (max._max.version ?? 0) + 1;
}

type SnapshotOverride = {
  version: number;
  content: string;
  summary: string | null;
  note: string | null;
  sourceVersionId: string | null;
};

/**
 * 将上一 KB 版本下的文档快照克隆到新 KB 版本；可对部分 documentId 使用覆盖（新内容/新版本号）
 */
export async function cloneDocumentSnapshotsToNewKbVersion(
  tx: DbTx,
  fromKbvId: string,
  toKbvId: string,
  userId: string,
  overrides: Map<string, SnapshotOverride>
) {
  const rows = await tx.knowledgeDocumentVersion.findMany({
    where: { knowledgeBaseVersionId: fromKbvId },
    include: { document: true },
  });
  rows.sort((a, b) => {
    if (a.document.sortOrder !== b.document.sortOrder) {
      return a.document.sortOrder - b.document.sortOrder;
    }
    return a.document.createdAt.getTime() - b.document.createdAt.getTime();
  });

  for (const row of rows) {
    const ov = overrides.get(row.documentId);
    await tx.knowledgeDocumentVersion.create({
      data: {
        documentId: row.documentId,
        knowledgeBaseVersionId: toKbvId,
        version: ov ? ov.version : row.version,
        content: ov ? ov.content : row.content,
        summary: ov ? ov.summary : row.summary,
        note: ov ? ov.note : row.note,
        sourceVersionId: ov ? ov.sourceVersionId : row.sourceVersionId,
        createdById: userId,
      },
    });
  }
}

export function sortSnapshots<
  T extends {
    document: { sortOrder: number; createdAt: Date };
  },
>(snaps: T[]): T[] {
  return [...snaps].sort((a, b) => {
    if (a.document.sortOrder !== b.document.sortOrder) {
      return a.document.sortOrder - b.document.sortOrder;
    }
    return a.document.createdAt.getTime() - b.document.createdAt.getTime();
  });
}
