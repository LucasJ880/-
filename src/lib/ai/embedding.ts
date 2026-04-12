/**
 * 向量嵌入服务
 *
 * 使用 OpenAI text-embedding-3-small (1536维, $0.02/1M tokens)
 * 用于记忆语义检索和冲突检测
 */

import { getClient } from "./client";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const trimmed = text.slice(0, 8000);

  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
    dimensions: DIMENSIONS,
  });

  return res.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const trimmed = texts.map((t) => t.slice(0, 8000));

  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
    dimensions: DIMENSIONS,
  });

  return res.data.map((d) => d.embedding);
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
