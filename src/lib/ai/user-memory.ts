/**
 * 用户级 AI 长期记忆 — 借鉴 MemPalace 4 层架构
 *
 * L0 (identity / preference): ~100 tokens, 始终加载
 * L1 (core): ~500 tokens, 每次对话加载 top N
 * L2 (on-demand): 向量语义检索 + 关键词兜底
 *
 * 向量检索: OpenAI text-embedding-3-small (1536维)
 * 冲突检测: 相似度 > 0.88 的同类记忆自动覆盖
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { generateEmbedding, cosineSimilarity } from "./embedding";

export type MemoryType =
  | "decision"
  | "preference"
  | "milestone"
  | "problem"
  | "insight"
  | "fact";

export interface MemoryEntry {
  id: string;
  memoryType: MemoryType;
  layer: number;
  content: string;
  tags: string | null;
  importance: number;
  createdAt: Date;
}

// ─── 存储 ─────────────────────────────────────────────────────

export async function saveMemory(params: {
  userId: string;
  memoryType: MemoryType;
  content: string;
  layer?: number;
  tags?: string;
  importance?: number;
  sourceThreadId?: string;
  customerId?: string;
  projectId?: string;
}): Promise<{ id: string }> {
  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(params.content);
  } catch { /* embedding 生成失败不阻塞存储 */ }

  // 冲突检测：偏好和决策类记忆，检查是否有语义冲突
  if (embedding && (params.memoryType === "preference" || params.memoryType === "decision")) {
    const superseded = await detectAndSupersede(
      params.userId,
      params.memoryType,
      embedding,
    );
    if (superseded) {
      // 直接更新旧记忆而非新建
      const updated = await db.userMemory.update({
        where: { id: superseded },
        data: {
          content: params.content,
          tags: params.tags ?? undefined,
          importance: params.importance ?? 3,
          embedding: embedding ?? Prisma.JsonNull,
          sourceThreadId: params.sourceThreadId ?? null,
        },
        select: { id: true },
      });
      return updated;
    }
  }

  const record = await db.userMemory.create({
    data: {
      userId: params.userId,
      memoryType: params.memoryType,
      content: params.content,
      layer: params.layer ?? 1,
      tags: params.tags ?? null,
      importance: params.importance ?? 3,
      sourceThreadId: params.sourceThreadId ?? null,
      customerId: params.customerId ?? null,
      projectId: params.projectId ?? null,
      embedding: embedding ?? undefined,
    },
    select: { id: true },
  });
  return record;
}

export async function saveMemories(
  userId: string,
  entries: Array<{
    memoryType: MemoryType;
    content: string;
    layer?: number;
    tags?: string;
    importance?: number;
    sourceThreadId?: string;
  }>
): Promise<number> {
  if (entries.length === 0) return 0;

  let saved = 0;
  for (const e of entries) {
    try {
      await saveMemory({
        userId,
        memoryType: e.memoryType,
        content: e.content,
        layer: e.layer,
        tags: e.tags,
        importance: e.importance,
        sourceThreadId: e.sourceThreadId,
      });
      saved++;
    } catch { /* 单条失败不阻塞其它 */ }
  }
  return saved;
}

// ─── L0 + L1：唤醒层 ─────────────────────────────────────────

/**
 * 获取 L0 + L1 记忆 — 每次对话启动时加载
 * L0: 用户偏好/身份（layer=0）
 * L1: 高重要度核心记忆（layer=1, 按 importance 排序）
 */
export async function getWakeUpMemories(
  userId: string,
  maxL1: number = 10
): Promise<{ l0: MemoryEntry[]; l1: MemoryEntry[] }> {
  const [l0, l1] = await Promise.all([
    db.userMemory.findMany({
      where: { userId, layer: 0 },
      orderBy: { importance: "desc" },
      take: 20,
    }),
    db.userMemory.findMany({
      where: { userId, layer: 1 },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: maxL1,
    }),
  ]);

  return {
    l0: l0 as MemoryEntry[],
    l1: l1 as MemoryEntry[],
  };
}

// ─── L2：按需检索 ─────────────────────────────────────────────

/**
 * 根据用户消息中的关键词，检索相关 L2 记忆
 * MVP 用 tag 匹配 + 内容 LIKE 查询
 */
export async function recallMemories(
  userId: string,
  query: string,
  options?: {
    customerId?: string;
    projectId?: string;
    limit?: number;
  }
): Promise<MemoryEntry[]> {
  const limit = options?.limit ?? 5;

  // 尝试向量检索
  let vectorResults: MemoryEntry[] = [];
  try {
    const queryEmbedding = await generateEmbedding(query);
    vectorResults = await vectorSearch(userId, queryEmbedding, {
      limit: limit * 2,
      customerId: options?.customerId,
      projectId: options?.projectId,
    });
  } catch { /* 向量检索失败，降级到关键词 */ }

  // 关键词兜底 / 补充
  const keywordResults = await keywordSearch(userId, query, {
    limit,
    customerId: options?.customerId,
    projectId: options?.projectId,
  });

  // 合并去重，向量结果优先
  const seen = new Set<string>();
  const merged: MemoryEntry[] = [];
  for (const m of [...vectorResults, ...keywordResults]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }

  const final = merged.slice(0, limit);

  if (final.length > 0) {
    await db.userMemory.updateMany({
      where: { id: { in: final.map((m) => m.id) } },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
  }

  return final;
}

async function vectorSearch(
  userId: string,
  queryEmbedding: number[],
  opts: { limit: number; customerId?: string; projectId?: string },
): Promise<MemoryEntry[]> {
  const where: Record<string, unknown> = {
    userId,
    layer: 2,
    embedding: { not: Prisma.JsonNullValueFilter.JsonNull },
  };
  if (opts.customerId) where.customerId = opts.customerId;
  if (opts.projectId) where.projectId = opts.projectId;

  const candidates = await db.userMemory.findMany({
    where: where as never,
    orderBy: [{ importance: "desc" }],
    take: 100,
  });

  const scored = candidates
    .map((m) => ({
      memory: m as MemoryEntry,
      similarity: cosineSimilarity(queryEmbedding, m.embedding as number[]),
    }))
    .filter((s) => s.similarity > 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.limit);

  return scored.map((s) => s.memory);
}

async function keywordSearch(
  userId: string,
  query: string,
  opts: { limit: number; customerId?: string; projectId?: string },
): Promise<MemoryEntry[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0 && !opts.customerId && !opts.projectId) {
    return [];
  }

  const conditions: object[] = [{ userId }];
  if (opts.customerId) conditions.push({ customerId: opts.customerId });
  if (opts.projectId) conditions.push({ projectId: opts.projectId });

  if (keywords.length > 0) {
    conditions.push({
      OR: keywords.flatMap((kw) => [
        { tags: { contains: kw } },
        { content: { contains: kw } },
      ]),
    });
  }

  const memories = await db.userMemory.findMany({
    where: { AND: conditions },
    orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
    take: opts.limit,
  });

  return memories as MemoryEntry[];
}

// ─── 冲突检测 ────────────────────────────────────────────────

const CONFLICT_THRESHOLD = 0.88;

async function detectAndSupersede(
  userId: string,
  memoryType: MemoryType,
  newEmbedding: number[],
): Promise<string | null> {
  const existing = await db.userMemory.findMany({
    where: {
      userId,
      memoryType,
      embedding: { not: Prisma.JsonNullValueFilter.JsonNull },
    },
    take: 50,
  });

  for (const m of existing) {
    const sim = cosineSimilarity(newEmbedding, m.embedding as number[]);
    if (sim >= CONFLICT_THRESHOLD) {
      return m.id;
    }
  }
  return null;
}

// ─── 记忆管理 CRUD ──────────────────────────────────────────

export async function listMemories(
  userId: string,
  opts?: {
    layer?: number;
    memoryType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: MemoryEntry[]; total: number }> {
  const where: Record<string, unknown> = { userId };
  if (opts?.layer !== undefined) where.layer = opts.layer;
  if (opts?.memoryType) where.memoryType = opts.memoryType;
  if (opts?.search) {
    where.OR = [
      { content: { contains: opts.search } },
      { tags: { contains: opts.search } },
    ];
  }

  const [items, total] = await Promise.all([
    db.userMemory.findMany({
      where: where as never,
      orderBy: [{ layer: "asc" }, { importance: "desc" }, { updatedAt: "desc" }],
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    db.userMemory.count({ where: where as never }),
  ]);

  return { items: items as MemoryEntry[], total };
}

export async function getMemoryById(
  userId: string,
  id: string,
): Promise<MemoryEntry | null> {
  const m = await db.userMemory.findFirst({
    where: { id, userId },
  });
  return m as MemoryEntry | null;
}

export async function updateMemory(
  userId: string,
  id: string,
  data: {
    content?: string;
    memoryType?: MemoryType;
    layer?: number;
    tags?: string;
    importance?: number;
  },
): Promise<MemoryEntry> {
  let embedding: number[] | undefined;
  if (data.content) {
    try {
      embedding = await generateEmbedding(data.content);
    } catch { /* ignore */ }
  }

  const updated = await db.userMemory.update({
    where: { id },
    data: {
      ...data,
      ...(embedding ? { embedding } : {}),
    },
  });
  return updated as MemoryEntry;
}

export async function deleteMemory(
  userId: string,
  id: string,
): Promise<void> {
  await db.userMemory.delete({
    where: { id },
  });
}

export async function backfillEmbeddings(userId: string): Promise<number> {
  const noEmbed = await db.userMemory.findMany({
    where: { userId, embedding: { equals: Prisma.JsonNull } },
    take: 100,
  });

  let count = 0;
  for (const m of noEmbed) {
    try {
      const emb = await generateEmbedding(m.content);
      await db.userMemory.update({
        where: { id: m.id },
        data: { embedding: emb },
      });
      count++;
    } catch { break; }
  }
  return count;
}

// ─── 格式化：注入 prompt ──────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  decision: "决策",
  preference: "偏好",
  milestone: "里程碑",
  problem: "问题",
  insight: "洞察",
  fact: "事实",
};

export function buildUserMemoryBlock(
  l0: MemoryEntry[],
  l1: MemoryEntry[],
  l2: MemoryEntry[] = []
): string {
  if (l0.length === 0 && l1.length === 0 && l2.length === 0) {
    return "";
  }

  const lines: string[] = ["\n### 用户长期记忆"];

  if (l0.length > 0) {
    lines.push("**用户偏好与身份：**");
    for (const m of l0) {
      lines.push(`- ${m.content}`);
    }
  }

  if (l1.length > 0) {
    lines.push("**核心记忆：**");
    for (const m of l1) {
      const label = TYPE_LABELS[m.memoryType] ?? m.memoryType;
      lines.push(`- [${label}] ${m.content}`);
    }
  }

  if (l2.length > 0) {
    lines.push("**相关回忆：**");
    for (const m of l2) {
      const label = TYPE_LABELS[m.memoryType] ?? m.memoryType;
      lines.push(`- [${label}] ${m.content}`);
    }
  }

  lines.push(
    "请参考以上记忆，保持一致性，避免与之前的决策/偏好矛盾。"
  );

  return lines.join("\n");
}

// ─── 记忆提取（从对话中自动抽取） ─────────────────────────────

const DECISION_PATTERNS = [
  /我们(决定|选择|确定|采用|用)(了)?/,
  /最终(方案|决定|选了|选择)/,
  /就(这么|这样)(做|定|办)/,
  /不(做|用|要|需要)[^。，]*了/,
  /(放弃|跳过|暂时不)/,
];

const PREFERENCE_PATTERNS = [
  /我(喜欢|偏好|习惯|一般|通常|总是|倾向)/,
  /请(始终|永远|总是|每次|一定)/,
  /不要(用|做|写|加)/,
  /优先(选择|使用|考虑)/,
];

const MILESTONE_PATTERNS = [
  /(完成|搞定|上线|部署|发布|push)(了|完毕)?/,
  /成功(了|实现|接入|集成)/,
  /第一次/,
  /(实现|建成|做好)了/,
];

const INSIGHT_PATTERNS = [
  /原来(是|如此)/,
  /发现(了)?/,
  /关键(是|在于|点)/,
  /核心(问题|原因|发现)/,
  /这(说明|意味着|表示)/,
];

export interface ExtractedMemory {
  memoryType: MemoryType;
  content: string;
  importance: number;
  tags: string;
}

/**
 * 从用户消息+AI回复中提取值得记住的记忆
 * 借鉴 MemPalace 的 general_extractor.py 纯关键词/模式匹配
 */
export function extractMemoriesFromConversation(
  userMessage: string,
  assistantReply: string
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const combined = userMessage + " " + assistantReply;

  const paragraphs = combined
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 20);

  for (const para of paragraphs) {
    const scored: Array<{ type: MemoryType; score: number }> = [];

    scored.push({
      type: "decision",
      score: countMatches(para, DECISION_PATTERNS),
    });
    scored.push({
      type: "preference",
      score: countMatches(para, PREFERENCE_PATTERNS),
    });
    scored.push({
      type: "milestone",
      score: countMatches(para, MILESTONE_PATTERNS),
    });
    scored.push({
      type: "insight",
      score: countMatches(para, INSIGHT_PATTERNS),
    });

    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score < 1) continue;

    const content = para.trim().slice(0, 500);
    const tags = extractTags(content);
    const importance = Math.min(5, 2 + best.score);

    memories.push({
      memoryType: best.type,
      content,
      importance,
      tags,
    });
  }

  return memories.slice(0, 3);
}

// ─── 工具函数 ─────────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pat of patterns) {
    if (pat.test(text)) count++;
  }
  return count;
}

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们",
  "这", "那", "有", "和", "与", "或", "但", "而", "也", "都",
  "就", "会", "能", "可以", "不", "没", "吗", "呢", "啊", "吧",
  "一个", "一些", "什么", "怎么", "为什么", "如何",
  "the", "a", "an", "is", "are", "was", "were", "to", "of",
  "and", "or", "but", "in", "on", "at", "for", "with",
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  return [...new Set(words)].slice(0, 8);
}

function extractTags(text: string): string {
  const keywords = extractKeywords(text);
  return keywords.slice(0, 5).join(",");
}
