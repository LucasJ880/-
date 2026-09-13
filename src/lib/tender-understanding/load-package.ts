/**
 * 招标包文档清单加载：分页直到完整，禁止 take: N 决定证据可用性。
 */

import { db } from "@/lib/db";
import type { AnalyzerPage } from "./contract";
import {
  INVENTORY_PAGE_SIZE,
  PAGE_ROW_BATCH_SIZE,
  paginateUntilComplete,
  type InventoryDocument,
} from "./package-input";

type DocumentRow = {
  id: string;
  title: string;
  fileType: string;
  parseStatus: string;
  contentText: string | null;
  pageCount: number | null;
  sortOrder: number;
  createdAt: Date;
  source: string;
  contentHash: string | null;
};

type PageRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  contentText: string;
  unitKind: string | null;
  unitLabel: string | null;
};

export async function loadAllProjectDocuments(
  projectId: string,
): Promise<DocumentRow[]> {
  return paginateUntilComplete<DocumentRow>({
    pageSize: INVENTORY_PAGE_SIZE,
    fetchPage: ({ take, skip }) =>
      db.projectDocument.findMany({
        where: { projectId },
        select: {
          id: true,
          title: true,
          fileType: true,
          parseStatus: true,
          contentText: true,
          pageCount: true,
          sortOrder: true,
          createdAt: true,
          source: true,
          contentHash: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take,
        skip,
      }),
  });
}

export async function loadAllDocumentPages(
  documentIds: string[],
): Promise<PageRow[]> {
  if (documentIds.length === 0) return [];
  return paginateUntilComplete<PageRow>({
    pageSize: PAGE_ROW_BATCH_SIZE,
    fetchPage: ({ take, skip }) =>
      db.projectDocumentPage.findMany({
        where: { documentId: { in: documentIds } },
        select: {
          id: true,
          documentId: true,
          pageNumber: true,
          contentText: true,
          unitKind: true,
          unitLabel: true,
        },
        orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
        take,
        skip,
      }),
  });
}

export async function loadTenderPackageInventory(
  projectId: string,
): Promise<InventoryDocument[]> {
  const rows = await loadAllProjectDocuments(projectId);
  const pages = await loadAllDocumentPages(rows.map((r) => r.id));
  const pagesByDoc = new Map<string, AnalyzerPage[]>();
  for (const p of pages) {
    const arr = pagesByDoc.get(p.documentId) ?? [];
    arr.push({
      pageNumber: p.pageNumber,
      contentText: p.contentText,
      unitKind: p.unitKind,
      unitLabel: p.unitLabel,
    });
    pagesByDoc.set(p.documentId, arr);
  }

  return rows.map((row) => {
    const docPages = pagesByDoc.get(row.id) ?? [];
    const characterCount =
      docPages.reduce((a, p) => a + p.contentText.length, 0) ||
      (row.contentText?.length ?? 0);
    return {
      documentId: row.id,
      title: row.title,
      fileType: row.fileType,
      parseStatus: row.parseStatus,
      characterCount,
      pageCount: row.pageCount,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      source: row.source,
      contentHash: row.contentHash,
      pages: docPages,
      contentText: row.contentText,
    };
  });
}
