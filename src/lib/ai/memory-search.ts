/**
 * 用户记忆检索 — 强制 orgId 隔离；只召回当前生效记忆
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { generateEmbedding, cosineSimilarity } from "./embedding";
import {
  type MemoryType,
  type MemoryEntry,
  preferRecentOnSimilarityTie,
} from "./memory-storage";

function requireOrgId(orgId: string | null | undefined): string {
  const id = (orgId || "").trim();
  if (!id) throw new Error("orgId 必填：记忆必须按组织隔离");
  return id;
}

/**
 * 获取 L0 + L1 记忆 — 每次对话启动时加载（仅本 org、仅生效中）
 * L1：importance 相同按 effectiveFrom 降序（偏新）
 */
export async function getWakeUpMemories(
  userId: string,
  orgId: string,
  maxL1: number = 10,
): Promise<{ l0: MemoryEntry[]; l1: MemoryEntry[] }> {
  const safeOrgId = requireOrgId(orgId);
  const [l0, l1] = await Promise.all([
    db.userMemory.findMany({
      where: { userId, orgId: safeOrgId, layer: 0, effectiveTo: null },
      orderBy: [{ importance: "desc" }, { effectiveFrom: "desc" }],
      take: 20,
    }),
    db.userMemory.findMany({
      where: { userId, orgId: safeOrgId, layer: 1, effectiveTo: null },
      orderBy: [{ importance: "desc" }, { effectiveFrom: "desc" }],
      take: maxL1,
    }),
  ]);

  return {
    l0: l0 as MemoryEntry[],
    l1: l1 as MemoryEntry[],
  };
}

/**
 * 根据用户消息检索相关 L2 记忆（仅本 org、仅生效中）
 */
export async function recallMemories(
  userId: string,
  orgId: string,
  query: string,
  options?: {
    customerId?: string;
    projectId?: string;
    limit?: number;
  },
): Promise<MemoryEntry[]> {
  const safeOrgId = requireOrgId(orgId);
  const limit = options?.limit ?? 5;

  type Scored = {
    memory: MemoryEntry;
    similarity: number;
    effectiveFrom: Date;
  };

  let vectorScored: Scored[] = [];
  try {
    const queryEmbedding = await generateEmbedding(query);
    vectorScored = await vectorSearchScored(userId, safeOrgId, queryEmbedding, {
      limit: limit * 2,
      customerId: options?.customerId,
      projectId: options?.projectId,
    });
  } catch {
    /* 向量检索失败，降级到关键词 */
  }

  const keywordResults = await keywordSearch(userId, safeOrgId, query, {
    limit,
    customerId: options?.customerId,
    projectId: options?.projectId,
  });

  const keywordScored: Scored[] = keywordResults.map((m, i) => ({
    memory: m,
    // 关键词结果给递减伪分，便于与向量合并后偏新破同分
    similarity: Math.max(0.31, 0.5 - i * 0.01),
    effectiveFrom: m.effectiveFrom ? new Date(m.effectiveFrom) : m.createdAt,
  }));

  const byId = new Map<string, Scored>();
  for (const s of [...vectorScored, ...keywordScored]) {
    const prev = byId.get(s.memory.id);
    if (!prev || s.similarity > prev.similarity) {
      byId.set(s.memory.id, s);
    }
  }

  const merged = Array.from(byId.values()).sort((a, b) =>
    preferRecentOnSimilarityTie(a, b, 0.02),
  );

  const final = merged.slice(0, limit).map((s) => s.memory);

  if (final.length > 0) {
    await db.userMemory.updateMany({
      where: {
        id: { in: final.map((m) => m.id) },
        orgId: safeOrgId,
        userId,
        effectiveTo: null,
      },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
  }

  return final;
}

async function vectorSearchScored(
  userId: string,
  orgId: string,
  queryEmbedding: number[],
  opts: { limit: number; customerId?: string; projectId?: string },
): Promise<
  Array<{ memory: MemoryEntry; similarity: number; effectiveFrom: Date }>
> {
  const where: Record<string, unknown> = {
    userId,
    orgId,
    layer: 2,
    effectiveTo: null,
    embedding: { not: Prisma.JsonNullValueFilter.JsonNull },
  };
  if (opts.customerId) where.customerId = opts.customerId;
  if (opts.projectId) where.projectId = opts.projectId;

  const candidates = await db.userMemory.findMany({
    where: where as never,
    orderBy: [{ importance: "desc" }, { effectiveFrom: "desc" }],
    take: 100,
  });

  const scored = candidates
    .map((m) => {
      const entry = m as MemoryEntry;
      return {
        memory: entry,
        similarity: cosineSimilarity(queryEmbedding, m.embedding as number[]),
        effectiveFrom: entry.effectiveFrom
          ? new Date(entry.effectiveFrom)
          : entry.createdAt,
      };
    })
    .filter((s) => s.similarity > 0.3)
    .sort((a, b) => preferRecentOnSimilarityTie(a, b, 0.02))
    .slice(0, opts.limit);

  return scored;
}

async function keywordSearch(
  userId: string,
  orgId: string,
  query: string,
  opts: { limit: number; customerId?: string; projectId?: string },
): Promise<MemoryEntry[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0 && !opts.customerId && !opts.projectId) {
    return [];
  }

  const conditions: object[] = [
    { userId },
    { orgId },
    { effectiveTo: null },
  ];
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
    orderBy: [
      { importance: "desc" },
      { effectiveFrom: "desc" },
      { accessCount: "desc" },
    ],
    take: opts.limit,
  });

  return memories as MemoryEntry[];
}

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
  l2: MemoryEntry[] = [],
): string {
  if (l0.length === 0 && l1.length === 0 && l2.length === 0) {
    return "";
  }

  const lines: string[] = ["\n### 用户长期记忆（仅当前组织）"];

  if (l0.length > 0) {
    lines.push("**用户偏好与身份：**");
    for (const m of l0) {
      lines.push(`- ${m.content.slice(0, 200)}`);
    }
  }

  if (l1.length > 0) {
    lines.push("**核心记忆：**");
    for (const m of l1) {
      const label = TYPE_LABELS[m.memoryType] ?? m.memoryType;
      lines.push(`- [${label}] ${m.content.slice(0, 200)}`);
    }
  }

  if (l2.length > 0) {
    lines.push("**相关回忆：**");
    for (const m of l2) {
      const label = TYPE_LABELS[m.memoryType] ?? m.memoryType;
      lines.push(`- [${label}] ${m.content.slice(0, 200)}`);
    }
  }

  lines.push(
    "请参考以上记忆，保持一致性；不得使用其他组织或未授权数据。",
  );

  return lines.join("\n");
}

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

export function extractMemoriesFromConversation(
  userMessage: string,
  assistantReply: string,
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
