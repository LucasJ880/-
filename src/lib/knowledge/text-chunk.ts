/**
 * 通用文本分块（组织知识向量化用）
 */

const MAX_CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 120;

export function chunkTextForEmbedding(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_CHARS) return [normalized];

  const parts = normalized.split(/(?<=[.!?。！？\n])/);
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if ((current + piece).length > MAX_CHUNK_CHARS && current) {
      chunks.push(current.trim());
      current = current.slice(-OVERLAP_CHARS) + piece;
    } else {
      current = current ? `${current}${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.slice(0, 80);
}
