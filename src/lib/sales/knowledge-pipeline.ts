/**
 * 销售知识管线 — 从沟通记录到可检索知识
 *
 * 负责：解析 -> 分块 -> AI 分析 -> embedding -> 写入 pgvector
 */

import { db } from "@/lib/db";
import { generateEmbedding, generateEmbeddings } from "@/lib/ai/embedding";
import { createCompletion } from "@/lib/ai/client";
import { setChunkEmbedding } from "./vector-search";

// ── 类型定义 ──

export interface RawCommunication {
  sourceType: "email" | "wechat" | "call_transcript" | "note" | "bulk_upload";
  content: string;
  customerId?: string;
  opportunityId?: string;
  interactionId?: string;
  metadata?: {
    speaker?: string;
    direction?: "inbound" | "outbound";
    timestamp?: string;
    dealStage?: string;
    language?: string;
  };
}

interface ChunkData {
  content: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
}

interface ChunkAnalysis {
  sentiment: "positive" | "negative" | "neutral";
  intent: "objection" | "inquiry" | "negotiation" | "closing" | "smalltalk" | "other";
  objectionType?: "price" | "timing" | "competition" | "authority" | "need";
  isWinPattern: boolean;
  isLossSignal: boolean;
  tags: string[];
  buyerSignals: string[];
  riskSignals: string[];
}

export interface PipelineResult {
  chunksCreated: number;
  errors: string[];
}

// ── 分块器 ──

const MAX_CHUNK_TOKENS = 400;
const OVERLAP_TOKENS = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function chunkCommunication(raw: RawCommunication): ChunkData[] {
  const { content, metadata } = raw;
  if (!content?.trim()) return [];

  const lines = content.split(/\n/);
  const dialoguePattern = /^[\[(【]?(?:customer|staff|client|sales|我|客户|销售|对方)[:\]】）]/i;
  const isDialogue = lines.some((l) => dialoguePattern.test(l.trim()));

  if (isDialogue) {
    return chunkByDialogueTurns(lines, metadata ?? {});
  }

  return chunkBySize(content, metadata ?? {});
}

function chunkByDialogueTurns(
  lines: string[],
  baseMeta: Record<string, unknown>,
): ChunkData[] {
  const chunks: ChunkData[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lineTokens = estimateTokens(trimmed);

    if (currentTokens + lineTokens > MAX_CHUNK_TOKENS && current.length > 0) {
      chunks.push({
        content: current.join("\n"),
        metadata: { ...baseMeta, chunkMethod: "dialogue_turn" },
      });
      const overlapLines = current.slice(-2);
      current = [...overlapLines, trimmed];
      currentTokens = overlapLines.reduce((s, l) => s + estimateTokens(l), 0) + lineTokens;
    } else {
      current.push(trimmed);
      currentTokens += lineTokens;
    }
  }

  if (current.length > 0) {
    chunks.push({
      content: current.join("\n"),
      metadata: { ...baseMeta, chunkMethod: "dialogue_turn" },
    });
  }

  return chunks;
}

function chunkBySize(text: string, baseMeta: Record<string, unknown>): ChunkData[] {
  const chunks: ChunkData[] = [];
  const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const tokens = estimateTokens(trimmed);

    if (currentTokens + tokens > MAX_CHUNK_TOKENS && current.length > 0) {
      chunks.push({
        content: current.join(" "),
        metadata: { ...baseMeta, chunkMethod: "size" },
      });
      const overlapText = current.slice(-1);
      current = [...overlapText, trimmed];
      currentTokens = estimateTokens(overlapText.join(" ")) + tokens;
    } else {
      current.push(trimmed);
      currentTokens += tokens;
    }
  }

  if (current.length > 0) {
    chunks.push({
      content: current.join(" "),
      metadata: { ...baseMeta, chunkMethod: "size" },
    });
  }

  return chunks;
}

// ── AI 分析器 ──

async function analyzeChunk(content: string): Promise<ChunkAnalysis> {
  const prompt = `Analyze this sales communication snippet. Return JSON only (no code blocks):
{
  "sentiment": "positive" | "negative" | "neutral",
  "intent": "objection" | "inquiry" | "negotiation" | "closing" | "smalltalk" | "other",
  "objectionType": "price" | "timing" | "competition" | "authority" | "need" | null,
  "isWinPattern": boolean (true if this contains effective sales technique that led to positive outcome),
  "isLossSignal": boolean (true if this contains warning signals of deal loss),
  "tags": string[] (3-5 relevant tags like "price_discussion", "product_comparison", "urgency"),
  "buyerSignals": string[] (positive buying indicators),
  "riskSignals": string[] (deal risk indicators)
}

Communication:
"""
${content.slice(0, 2000)}
"""`;

  try {
    const result = await createCompletion({
      systemPrompt:
        "You are a sales communication analyst. Analyze the given snippet and return structured JSON. Be conservative: only mark isWinPattern if there is clear evidence of effective technique, only mark isLossSignal if there are clear warning signs.",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.2,
      maxTokens: 500,
    });

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      sentiment: "neutral",
      intent: "other",
      isWinPattern: false,
      isLossSignal: false,
      tags: [],
      buyerSignals: [],
      riskSignals: [],
    };
  }
}

// ── 主管线 ──

export async function indexCommunication(
  raw: RawCommunication,
): Promise<PipelineResult> {
  const errors: string[] = [];
  const chunks = chunkCommunication(raw);

  if (chunks.length === 0) {
    return { chunksCreated: 0, errors: ["No content to chunk"] };
  }

  const chunkContents = chunks.map((c) => c.content);

  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(chunkContents);
  } catch (e) {
    return { chunksCreated: 0, errors: [`Embedding failed: ${e}`] };
  }

  let created = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const analysis = await analyzeChunk(chunks[i].content);

      const chunk = await db.salesKnowledgeChunk.create({
        data: {
          sourceType: raw.sourceType,
          sourceId: raw.interactionId ?? undefined,
          customerId: raw.customerId ?? undefined,
          opportunityId: raw.opportunityId ?? undefined,
          interactionId: raw.interactionId ?? undefined,
          content: chunks[i].content,
          metadata: chunks[i].metadata as Record<string, string | number | boolean | null>,
          tags: analysis.tags,
          language: raw.metadata?.language ?? "en",
          sentiment: analysis.sentiment,
          intent: analysis.intent,
          objectionType: analysis.objectionType ?? undefined,
          isWinPattern: analysis.isWinPattern,
          isLossSignal: analysis.isLossSignal,
        },
      });

      await setChunkEmbedding(chunk.id, embeddings[i]);
      created++;
    } catch (e) {
      errors.push(`Chunk ${i} failed: ${e}`);
    }
  }

  if (raw.interactionId) {
    await db.customerInteraction.update({
      where: { id: raw.interactionId },
      data: {
        analysisStatus: errors.length === 0 ? "analyzed" : "failed",
        analysisResult: errors.length === 0
          ? { chunksCreated: created }
          : { chunksCreated: created, errors },
      },
    }).catch(() => {});
  }

  return { chunksCreated: created, errors };
}

// ── 批量索引 ──

export async function indexBulkUpload(
  items: RawCommunication[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; success: number; errors: string[] }> {
  const allErrors: string[] = [];
  let success = 0;

  for (let i = 0; i < items.length; i++) {
    const result = await indexCommunication(items[i]);
    if (result.errors.length === 0) {
      success++;
    } else {
      allErrors.push(...result.errors.map((e) => `Item ${i}: ${e}`));
    }
    onProgress?.(i + 1, items.length);
  }

  return { total: items.length, success, errors: allErrors };
}

// ── 文件解析器 ──

export function parseTextUpload(text: string, defaultSource: string = "bulk_upload"): RawCommunication[] {
  const sections = text.split(/\n---+\n|\n={3,}\n/);

  if (sections.length <= 1) {
    return [{
      sourceType: defaultSource as RawCommunication["sourceType"],
      content: text.trim(),
    }];
  }

  return sections
    .map((section) => section.trim())
    .filter((s) => s.length > 20)
    .map((section) => ({
      sourceType: defaultSource as RawCommunication["sourceType"],
      content: section,
    }));
}

export function parseCsvUpload(
  rows: Array<Record<string, string>>,
): RawCommunication[] {
  return rows
    .filter((r) => r.content || r.summary || r.message)
    .map((r) => ({
      sourceType: (r.type as RawCommunication["sourceType"]) || "note",
      content: r.content || r.summary || r.message || "",
      metadata: {
        speaker: r.speaker || r.from || undefined,
        direction: (r.direction as "inbound" | "outbound") || undefined,
        timestamp: r.date || r.timestamp || r.time || undefined,
        language: r.language || undefined,
      },
    }));
}

// ── 索引已有 CustomerInteraction（回填） ──

export async function backfillInteractions(
  opts?: { limit?: number; customerId?: string },
): Promise<{ processed: number; errors: string[] }> {
  const where: Record<string, unknown> = {
    OR: [
      { analysisStatus: null },
      { analysisStatus: "pending" },
    ],
  };
  if (opts?.customerId) {
    where.customerId = opts.customerId;
  }

  const interactions = await db.customerInteraction.findMany({
    where,
    take: opts?.limit ?? 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerId: true,
      opportunityId: true,
      type: true,
      content: true,
      summary: true,
      channel: true,
      language: true,
      rawMessages: true,
      direction: true,
    },
  });

  const errors: string[] = [];
  let processed = 0;

  for (const interaction of interactions) {
    const textContent = interaction.content || interaction.summary || "";
    if (!textContent.trim()) continue;

    await db.customerInteraction.update({
      where: { id: interaction.id },
      data: { analysisStatus: "pending" },
    });

    const result = await indexCommunication({
      sourceType: (interaction.channel as RawCommunication["sourceType"]) || "note",
      content: textContent,
      customerId: interaction.customerId,
      opportunityId: interaction.opportunityId ?? undefined,
      interactionId: interaction.id,
      metadata: {
        direction: interaction.direction as "inbound" | "outbound" | undefined,
        language: interaction.language ?? undefined,
      },
    });

    if (result.errors.length > 0) {
      errors.push(...result.errors);
    } else {
      processed++;
    }
  }

  return { processed, errors };
}
