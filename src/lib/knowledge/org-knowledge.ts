/**
 * 组织通用知识库 — CRUD + vault 导入 + 向量索引
 * 青砚为真相源；Obsidian 仅导入，不双向同步。
 */

import { db } from "@/lib/db";
import { generateEmbeddings } from "@/lib/ai/embedding";
import { toSql } from "pgvector";
import {
  extractTextFilesFromZip,
  parseVaultFiles,
  type VaultFileInput,
} from "@/lib/knowledge/markdown-vault-import";
import { chunkTextForEmbedding } from "@/lib/knowledge/text-chunk";

export interface CreateOrgKnowledgeInput {
  orgId: string;
  userId?: string;
  title: string;
  content: string;
  category?: string;
  tags?: string | null;
  language?: string;
  sourceType?: string;
  sourcePath?: string | null;
  /** 默认 true：写入后异步也可同步建索引 */
  indexVectors?: boolean;
}

async function ensureVectorExtension() {
  try {
    await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch {
    // already exists or no permission
  }
}

export async function listOrgKnowledge(
  orgId: string,
  opts?: { category?: string; take?: number },
) {
  return db.orgKnowledgeDocument.findMany({
    where: {
      orgId,
      status: "active",
      ...(opts?.category ? { category: opts.category } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: opts?.take ?? 100,
    select: {
      id: true,
      title: true,
      category: true,
      tags: true,
      language: true,
      sourceType: true,
      sourcePath: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { chunks: true } },
    },
  });
}

export async function getOrgKnowledge(orgId: string, id: string) {
  return db.orgKnowledgeDocument.findFirst({
    where: { id, orgId },
  });
}

export async function deleteOrgKnowledge(orgId: string, id: string) {
  const existing = await db.orgKnowledgeDocument.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!existing) return null;
  await db.orgKnowledgeDocument.delete({ where: { id } });
  return existing;
}

export async function indexOrgKnowledgeDocument(documentId: string) {
  const doc = await db.orgKnowledgeDocument.findUnique({
    where: { id: documentId },
  });
  if (!doc || doc.status !== "active") return { chunks: 0 };

  await ensureVectorExtension();
  await db.orgKnowledgeChunk.deleteMany({ where: { documentId } });

  const pieces = chunkTextForEmbedding(`${doc.title}\n\n${doc.content}`);
  if (pieces.length === 0) return { chunks: 0 };

  const embeddings = await generateEmbeddings(pieces);
  for (let i = 0; i < pieces.length; i++) {
    const chunk = await db.orgKnowledgeChunk.create({
      data: {
        orgId: doc.orgId,
        documentId: doc.id,
        chunkIndex: i,
        content: pieces[i]!,
      },
    });
    const vec = embeddings[i];
    if (vec?.length) {
      await db.$executeRawUnsafe(
        `UPDATE "OrgKnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
        toSql(vec),
        chunk.id,
      );
    }
  }
  return { chunks: pieces.length };
}

export async function createOrgKnowledge(input: CreateOrgKnowledgeInput) {
  const doc = await db.orgKnowledgeDocument.create({
    data: {
      orgId: input.orgId,
      title: input.title.slice(0, 200),
      content: input.content,
      category: (input.category || "general").slice(0, 40),
      tags: input.tags || null,
      language: (input.language || "zh").slice(0, 10),
      sourceType: input.sourceType || "manual",
      sourcePath: input.sourcePath || null,
      createdById: input.userId || null,
    },
  });
  if (input.indexVectors !== false) {
    try {
      await indexOrgKnowledgeDocument(doc.id);
    } catch (error) {
      console.warn("[OrgKnowledge] vector index failed", error);
    }
  }
  return doc;
}

export async function importVaultToOrgKnowledge(input: {
  orgId: string;
  userId: string;
  files: VaultFileInput[];
  defaultCategory?: string;
  indexVectors?: boolean;
}) {
  const { documents, skipped } = parseVaultFiles(input.files, {
    defaultCategory: input.defaultCategory || "general",
    maxFiles: 200,
  });
  const created: Array<{ id: string; title: string; category: string }> = [];
  for (const doc of documents) {
    const row = await createOrgKnowledge({
      orgId: input.orgId,
      userId: input.userId,
      title: doc.title,
      content: `${doc.content}\n\n<!-- source: ${doc.sourcePath} -->`,
      category: doc.category,
      tags: [doc.tags, "vault-import"].filter(Boolean).join(","),
      language: doc.language,
      sourceType: "vault_import",
      sourcePath: doc.sourcePath,
      indexVectors: input.indexVectors !== false,
    });
    created.push({ id: row.id, title: row.title, category: row.category });
  }
  return { created: created.length, documents: created, skipped };
}

export async function importZipToOrgKnowledge(input: {
  orgId: string;
  userId: string;
  zip: Uint8Array;
  defaultCategory?: string;
  indexVectors?: boolean;
}) {
  const files = extractTextFilesFromZip(input.zip);
  if (files.length === 0) {
    throw new Error("ZIP 中未找到 .md / .txt 文本文件");
  }
  return importVaultToOrgKnowledge({
    orgId: input.orgId,
    userId: input.userId,
    files,
    defaultCategory: input.defaultCategory,
    indexVectors: input.indexVectors,
  });
}

export interface OrgKnowledgeSearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  category: string;
  content: string;
  similarity: number;
  sourcePath: string | null;
}

/** 向量检索；无 embedding 配置或失败时回退关键词 */
export async function searchOrgKnowledge(input: {
  orgId: string;
  query: string;
  limit?: number;
  minSimilarity?: number;
  category?: string;
}): Promise<{ mode: "vector" | "keyword"; hits: OrgKnowledgeSearchHit[] }> {
  const limit = input.limit ?? 8;
  const minSimilarity = input.minSimilarity ?? 0.25;
  const query = input.query.trim();
  if (!query) return { mode: "keyword", hits: [] };

  try {
    const { generateEmbedding } = await import("@/lib/ai/embedding");
    const embedding = await generateEmbedding(query);
    if (embedding?.length) {
      await ensureVectorExtension();
      const vec = toSql(embedding);
      const rows = input.category
        ? await db.$queryRawUnsafe<
            Array<{
              chunkId: string;
              documentId: string;
              title: string;
              category: string;
              content: string;
              sourcePath: string | null;
              similarity: number;
            }>
          >(
            `
            SELECT
              c.id AS "chunkId",
              c."documentId",
              d.title,
              d.category,
              c.content,
              d."sourcePath",
              (1 - (c.embedding <=> $1::vector))::float AS similarity
            FROM "OrgKnowledgeChunk" c
            INNER JOIN "OrgKnowledgeDocument" d ON d.id = c."documentId"
            WHERE c."orgId" = $2
              AND d.status = 'active'
              AND c.embedding IS NOT NULL
              AND d.category = $4
            ORDER BY c.embedding <=> $1::vector
            LIMIT $3
            `,
            vec,
            input.orgId,
            limit * 2,
            input.category,
          )
        : await db.$queryRawUnsafe<
            Array<{
              chunkId: string;
              documentId: string;
              title: string;
              category: string;
              content: string;
              sourcePath: string | null;
              similarity: number;
            }>
          >(
            `
            SELECT
              c.id AS "chunkId",
              c."documentId",
              d.title,
              d.category,
              c.content,
              d."sourcePath",
              (1 - (c.embedding <=> $1::vector))::float AS similarity
            FROM "OrgKnowledgeChunk" c
            INNER JOIN "OrgKnowledgeDocument" d ON d.id = c."documentId"
            WHERE c."orgId" = $2
              AND d.status = 'active'
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> $1::vector
            LIMIT $3
            `,
            vec,
            input.orgId,
            limit * 2,
          );
      const hits = rows
        .filter((row) => row.similarity >= minSimilarity)
        .slice(0, limit)
        .map((row) => ({
          chunkId: row.chunkId,
          documentId: row.documentId,
          title: row.title,
          category: row.category,
          content: row.content,
          similarity: row.similarity,
          sourcePath: row.sourcePath,
        }));
      if (hits.length > 0) return { mode: "vector", hits };
    }
  } catch (error) {
    console.warn("[OrgKnowledge] vector search fallback", error);
    try {
      const { noteEmbeddingFailure } = await import("@/lib/ai/embedding");
      noteEmbeddingFailure(
        error instanceof Error ? error.message : String(error),
      );
    } catch {
      /* ignore */
    }
  }

  return {
    mode: "keyword",
    hits: await keywordSearchOrgKnowledge({
      orgId: input.orgId,
      query,
      limit,
      category: input.category,
    }),
  };
}

async function keywordSearchOrgKnowledge(input: {
  orgId: string;
  query: string;
  limit: number;
  category?: string;
}): Promise<OrgKnowledgeSearchHit[]> {
  const keywords = input.query
    .toLowerCase()
    .split(/[\s,，。!！?？]+/)
    .filter((w) => w.length >= 2);
  const docs = await db.orgKnowledgeDocument.findMany({
    where: {
      orgId: input.orgId,
      status: "active",
      ...(input.category ? { category: input.category } : {}),
    },
    take: 200,
  });
  return docs
    .map((doc) => {
      const text = `${doc.title} ${doc.tags ?? ""} ${doc.content}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) if (text.includes(kw)) score += 1;
      return { doc, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((row) => ({
      chunkId: row.doc.id,
      documentId: row.doc.id,
      title: row.doc.title,
      category: row.doc.category,
      content: row.doc.content.slice(0, 800),
      similarity: row.score / Math.max(keywords.length, 1),
      sourcePath: row.doc.sourcePath,
    }));
}

export function formatOrgKnowledgeHits(
  hits: OrgKnowledgeSearchHit[],
): string {
  if (hits.length === 0) return "";
  return hits
    .map(
      (hit) =>
        `[${hit.category}] ${hit.title} (sim=${hit.similarity.toFixed(2)})\n${hit.content.slice(0, 500)}`,
    )
    .join("\n\n---\n\n");
}
