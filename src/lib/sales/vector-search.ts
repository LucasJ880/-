/**
 * pgvector 向量搜索工具
 *
 * 封装 pgvector 的相似度查询，提供类型安全的 API。
 * 支持纯向量搜索和混合搜索（vector + keyword + metadata filter）。
 */

import { db } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embedding";
import { toSql } from "pgvector";

// ── 类型定义 ──

export interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown> | null;
  sourceType: string;
  customerId: string | null;
  opportunityId: string | null;
  tags: string[];
  sentiment: string | null;
  intent: string | null;
  objectionType: string | null;
  isWinPattern: boolean;
  isLossSignal: boolean;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  minSimilarity?: number;
  filters?: {
    customerId?: string;
    opportunityId?: string;
    sourceType?: string;
    intent?: string;
    isWinPattern?: boolean;
    isLossSignal?: boolean;
    tags?: string[];
  };
}

export interface InsightSearchResult {
  id: string;
  title: string;
  description: string;
  similarity: number;
  insightType: string;
  dealStage: string | null;
  productType: string | null;
  effectiveness: number;
  usageCount: number;
  successCount: number;
}

// ── pgvector 扩展初始化 ──

let extensionReady = false;

async function ensureExtension() {
  if (extensionReady) return;
  try {
    await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    extensionReady = true;
  } catch {
    console.warn("[VectorSearch] pgvector extension may already exist or cannot be created");
    extensionReady = true;
  }
}

// ── 向量写入 ──

export async function setChunkEmbedding(chunkId: string, embedding: number[]) {
  await ensureExtension();
  const vec = toSql(embedding);
  await db.$executeRawUnsafe(
    `UPDATE "SalesKnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
    vec,
    chunkId,
  );
}

export async function setInsightEmbedding(insightId: string, embedding: number[]) {
  await ensureExtension();
  const vec = toSql(embedding);
  await db.$executeRawUnsafe(
    `UPDATE "SalesInsight" SET embedding = $1::vector WHERE id = $2`,
    vec,
    insightId,
  );
}

export async function setProfileEmbedding(profileId: string, embedding: number[]) {
  await ensureExtension();
  const vec = toSql(embedding);
  await db.$executeRawUnsafe(
    `UPDATE "CustomerProfile" SET embedding = $1::vector WHERE id = $2`,
    vec,
    profileId,
  );
}

export async function setPlaybookEmbedding(playbookId: string, embedding: number[]) {
  await ensureExtension();
  const vec = toSql(embedding);
  await db.$executeRawUnsafe(
    `UPDATE "SalesPlaybook" SET embedding = $1::vector WHERE id = $2`,
    vec,
    playbookId,
  );
}

// ── 知识分块搜索 ──

export async function searchKnowledgeChunks(
  opts: SearchOptions,
): Promise<VectorSearchResult[]> {
  await ensureExtension();
  const embedding = await generateEmbedding(opts.query);
  const vec = toSql(embedding);
  const limit = opts.limit ?? 10;
  const minSim = opts.minSimilarity ?? 0.3;

  const conditions: string[] = [`embedding IS NOT NULL`];
  const params: unknown[] = [vec, limit];
  let paramIdx = 3;

  if (opts.filters?.customerId) {
    conditions.push(`"customerId" = $${paramIdx}`);
    params.push(opts.filters.customerId);
    paramIdx++;
  }
  if (opts.filters?.opportunityId) {
    conditions.push(`"opportunityId" = $${paramIdx}`);
    params.push(opts.filters.opportunityId);
    paramIdx++;
  }
  if (opts.filters?.sourceType) {
    conditions.push(`"sourceType" = $${paramIdx}`);
    params.push(opts.filters.sourceType);
    paramIdx++;
  }
  if (opts.filters?.intent) {
    conditions.push(`intent = $${paramIdx}`);
    params.push(opts.filters.intent);
    paramIdx++;
  }
  if (opts.filters?.isWinPattern !== undefined) {
    conditions.push(`"isWinPattern" = $${paramIdx}`);
    params.push(opts.filters.isWinPattern);
    paramIdx++;
  }
  if (opts.filters?.isLossSignal !== undefined) {
    conditions.push(`"isLossSignal" = $${paramIdx}`);
    params.push(opts.filters.isLossSignal);
    paramIdx++;
  }

  const whereClause = conditions.join(" AND ");

  const results = await db.$queryRawUnsafe<VectorSearchResult[]>(
    `SELECT
       id, content,
       1 - (embedding <=> $1::vector) AS similarity,
       metadata, "sourceType", "customerId", "opportunityId",
       tags, sentiment, intent, "objectionType",
       "isWinPattern", "isLossSignal"
     FROM "SalesKnowledgeChunk"
     WHERE ${whereClause}
       AND 1 - (embedding <=> $1::vector) >= ${minSim}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    ...params,
  );

  return results;
}

// ── 销售洞察搜索 ──

export async function searchInsights(
  query: string,
  opts?: {
    limit?: number;
    dealStage?: string;
    insightType?: string;
    minEffectiveness?: number;
  },
): Promise<InsightSearchResult[]> {
  await ensureExtension();
  const embedding = await generateEmbedding(query);
  const vec = toSql(embedding);
  const limit = opts?.limit ?? 5;

  const conditions: string[] = [
    `embedding IS NOT NULL`,
    `status = 'active'`,
  ];
  const params: unknown[] = [vec, limit];
  let paramIdx = 3;

  if (opts?.dealStage) {
    conditions.push(`("dealStage" = $${paramIdx} OR "dealStage" IS NULL)`);
    params.push(opts.dealStage);
    paramIdx++;
  }
  if (opts?.insightType) {
    conditions.push(`"insightType" = $${paramIdx}`);
    params.push(opts.insightType);
    paramIdx++;
  }
  if (opts?.minEffectiveness !== undefined) {
    conditions.push(`effectiveness >= ${opts.minEffectiveness}`);
  }

  const whereClause = conditions.join(" AND ");

  const results = await db.$queryRawUnsafe<InsightSearchResult[]>(
    `SELECT
       id, title, description,
       1 - (embedding <=> $1::vector) AS similarity,
       "insightType", "dealStage", "productType",
       effectiveness, "usageCount", "successCount"
     FROM "SalesInsight"
     WHERE ${whereClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    ...params,
  );

  return results;
}

// ── 混合搜索（vector + keyword） ──

export async function hybridSearch(
  query: string,
  opts?: {
    limit?: number;
    customerId?: string;
    keywordBoost?: number;
  },
): Promise<VectorSearchResult[]> {
  await ensureExtension();
  const embedding = await generateEmbedding(query);
  const vec = toSql(embedding);
  const limit = opts?.limit ?? 10;
  const kwBoost = opts?.keywordBoost ?? 0.3;

  const conditions: string[] = [`embedding IS NOT NULL`];
  const params: unknown[] = [vec, `%${query}%`, limit];
  let paramIdx = 4;

  if (opts?.customerId) {
    conditions.push(`"customerId" = $${paramIdx}`);
    params.push(opts.customerId);
    paramIdx++;
  }

  const whereClause = conditions.join(" AND ");

  const results = await db.$queryRawUnsafe<VectorSearchResult[]>(
    `SELECT
       id, content,
       (1 - (embedding <=> $1::vector)) +
       CASE WHEN content ILIKE $2 THEN ${kwBoost} ELSE 0 END AS similarity,
       metadata, "sourceType", "customerId", "opportunityId",
       tags, sentiment, intent, "objectionType",
       "isWinPattern", "isLossSignal"
     FROM "SalesKnowledgeChunk"
     WHERE ${whereClause}
     ORDER BY similarity DESC
     LIMIT $3`,
    ...params,
  );

  return results;
}

// ── HNSW 索引创建（一次性调用） ──

export async function createVectorIndexes() {
  await ensureExtension();
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_chunk_embedding ON "SalesKnowledgeChunk" USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS idx_insight_embedding ON "SalesInsight" USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS idx_profile_embedding ON "CustomerProfile" USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS idx_playbook_embedding ON "SalesPlaybook" USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS idx_faq_embedding ON "SalesFAQ" USING hnsw (embedding vector_cosine_ops)`,
  ];

  for (const sql of indexes) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn(`[VectorSearch] Index creation warning:`, e);
    }
  }
}
