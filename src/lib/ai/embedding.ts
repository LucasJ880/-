/**
 * 向量嵌入服务
 *
 * 使用 OpenAI text-embedding-3-small (1536维, $0.02/1M tokens)
 * 用于记忆语义检索和冲突检测
 *
 * 缓存策略：
 * - 进程内 LRU（500 条），同一个 lambda 生命周期内重复文本直接命中
 * - 同一文本在不同实例上仍可能重复调用；如需跨实例，可后续加 Upstash Redis 层
 */

import { createHash } from "node:crypto";
import { getClient } from "./client";
import { recordAiCall } from "./monitor";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

const MAX_CACHE = 500;
const cache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cacheGet(key: string): number[] | undefined {
  const v = cache.get(key);
  if (v) {
    // LRU：命中后移到末尾
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(key: string, value: number[]) {
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmed = text.slice(0, 8000);
  const key = cacheKey(trimmed);
  const hit = cacheGet(key);
  if (hit) return hit;

  const client = getClient();
  const t0 = Date.now();
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
    dimensions: DIMENSIONS,
  });

  const usage = (res as unknown as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage;
  recordAiCall({
    model: EMBEDDING_MODEL,
    success: true,
    elapsedMs: Date.now() - t0,
    source: "embedding",
    promptTokens: usage?.prompt_tokens,
    totalTokens: usage?.total_tokens,
  });

  const embedding = res.data[0].embedding;
  cacheSet(key, embedding);
  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const trimmed = texts.map((t) => t.slice(0, 8000));
  const results: (number[] | null)[] = trimmed.map((t) => cacheGet(cacheKey(t)) ?? null);

  const missingIndexes: number[] = [];
  const missingTexts: string[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (results[i] === null) {
      missingIndexes.push(i);
      missingTexts.push(trimmed[i]);
    }
  }

  if (missingTexts.length > 0) {
    const client = getClient();
    const t0 = Date.now();
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: missingTexts,
      dimensions: DIMENSIONS,
    });

    const usage = (res as unknown as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage;
    recordAiCall({
      model: EMBEDDING_MODEL,
      success: true,
      elapsedMs: Date.now() - t0,
      source: "embedding-batch",
      promptTokens: usage?.prompt_tokens,
      totalTokens: usage?.total_tokens,
    });

    for (let j = 0; j < missingIndexes.length; j++) {
      const idx = missingIndexes[j];
      const emb = res.data[j].embedding;
      results[idx] = emb;
      cacheSet(cacheKey(missingTexts[j]), emb);
    }
  }

  return results as number[][];
}

/** 测试/调试用：清空缓存 */
export function _clearEmbeddingCache() {
  cache.clear();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
