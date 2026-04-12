/**
 * Trade 外贸获客 — 产品知识库服务
 *
 * MVP 方案：文本存储 + 关键词匹配检索
 * 后续可升级为向量数据库 + embedding 检索
 */

import { db } from "@/lib/db";

export interface CreateKnowledgeInput {
  orgId: string;
  category: string;
  title: string;
  content: string;
  tags?: string;
  language?: string;
  createdById?: string;
}

export async function createKnowledge(input: CreateKnowledgeInput) {
  return db.tradeKnowledge.create({ data: input });
}

export async function listKnowledge(orgId: string, opts?: { category?: string }) {
  return db.tradeKnowledge.findMany({
    where: {
      orgId,
      isActive: true,
      ...(opts?.category ? { category: opts.category } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getKnowledge(id: string) {
  return db.tradeKnowledge.findUnique({ where: { id } });
}

export async function updateKnowledge(id: string, data: Partial<CreateKnowledgeInput> & { isActive?: boolean }) {
  return db.tradeKnowledge.update({ where: { id }, data });
}

export async function deleteKnowledge(id: string) {
  return db.tradeKnowledge.delete({ where: { id } });
}

/**
 * 检索与查询相关的知识片段
 * MVP: 基于关键词匹配（title/tags/content 包含查询词）
 */
export async function searchKnowledge(
  orgId: string,
  query: string,
  opts?: { category?: string; limit?: number },
): Promise<string> {
  const limit = opts?.limit ?? 5;
  const keywords = query
    .toLowerCase()
    .split(/[\s,，。!！?？]+/)
    .filter((w) => w.length >= 2);

  if (keywords.length === 0) return "";

  const allDocs = await db.tradeKnowledge.findMany({
    where: {
      orgId,
      isActive: true,
      ...(opts?.category ? { category: opts.category } : {}),
    },
    select: { title: true, content: true, tags: true, category: true },
  });

  const scored = allDocs.map((doc) => {
    const text = `${doc.title} ${doc.tags ?? ""} ${doc.content}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    return { ...doc, score };
  });

  const relevant = scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (relevant.length === 0) return "";

  return relevant
    .map((d) => `[${d.category}] ${d.title}\n${d.content.slice(0, 500)}`)
    .join("\n\n---\n\n");
}
