/**
 * 用户记忆 CRUD — 强制 orgId 隔离
 * 冲突时 supersede：关闭旧行 + 新建生效行（保留历史）
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
  orgId: string;
  memoryType: MemoryType;
  layer: number;
  content: string;
  tags: string | null;
  importance: number;
  createdAt: Date;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  supersedesId?: string | null;
  supersededById?: string | null;
}

const CONFLICT_THRESHOLD = 0.88;

/** 当前生效记忆过滤条件 */
export function activeMemoryWhere(): { effectiveTo: null } {
  return { effectiveTo: null };
}

function requireOrgId(orgId: string | null | undefined): string {
  const id = (orgId || "").trim();
  if (!id) throw new Error("orgId 必填：记忆必须按组织隔离");
  return id;
}

async function detectAndSupersede(
  orgId: string,
  userId: string,
  memoryType: MemoryType,
  newEmbedding: number[],
): Promise<string | null> {
  const existing = await db.userMemory.findMany({
    where: {
      orgId,
      userId,
      memoryType,
      effectiveTo: null,
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

/**
 * 原子 supersede：同一时刻关闭旧记忆并打开新记忆
 */
export async function supersedeMemory(input: {
  orgId: string;
  userId: string;
  oldId: string;
  memoryType: MemoryType;
  content: string;
  layer?: number;
  tags?: string | null;
  importance?: number;
  sourceThreadId?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  embedding?: number[] | null;
}): Promise<{ id: string }> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const owned = await tx.userMemory.findFirst({
      where: {
        id: input.oldId,
        orgId: input.orgId,
        userId: input.userId,
        effectiveTo: null,
      },
      select: { id: true, layer: true, customerId: true, projectId: true },
    });
    if (!owned) {
      throw new Error("被取代记忆不存在、已失效或跨组织");
    }

    const created = await tx.userMemory.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        memoryType: input.memoryType,
        content: input.content,
        layer: input.layer ?? owned.layer,
        tags: input.tags ?? null,
        importance: input.importance ?? 3,
        sourceThreadId: input.sourceThreadId ?? null,
        customerId: input.customerId ?? owned.customerId,
        projectId: input.projectId ?? owned.projectId,
        embedding: input.embedding ?? undefined,
        supersedesId: owned.id,
        effectiveFrom: now,
        effectiveTo: null,
      },
      select: { id: true },
    });

    await tx.userMemory.update({
      where: { id: owned.id },
      data: {
        effectiveTo: now,
        supersededById: created.id,
      },
    });

    return created;
  });
}

export async function saveMemory(params: {
  orgId: string;
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
  const orgId = requireOrgId(params.orgId);
  if (!params.userId) throw new Error("userId 必填");

  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(params.content);
  } catch {
    /* embedding 生成失败不阻塞存储 */
  }

  if (
    embedding &&
    (params.memoryType === "preference" || params.memoryType === "decision")
  ) {
    const superseded = await detectAndSupersede(
      orgId,
      params.userId,
      params.memoryType,
      embedding,
    );
    if (superseded) {
      try {
        return await supersedeMemory({
          orgId,
          userId: params.userId,
          oldId: superseded,
          memoryType: params.memoryType,
          content: params.content,
          layer: params.layer,
          tags: params.tags ?? null,
          importance: params.importance ?? 3,
          sourceThreadId: params.sourceThreadId ?? null,
          customerId: params.customerId ?? null,
          projectId: params.projectId ?? null,
          embedding,
        });
      } catch {
        /* 旧行竞态失效则走新建 */
      }
    }
  }

  const now = new Date();
  const record = await db.userMemory.create({
    data: {
      orgId,
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
      effectiveFrom: now,
      effectiveTo: null,
    },
    select: { id: true },
  });
  return record;
}

export async function saveMemories(
  userId: string,
  orgId: string,
  entries: Array<{
    memoryType: MemoryType;
    content: string;
    layer?: number;
    tags?: string;
    importance?: number;
    sourceThreadId?: string;
  }>,
): Promise<number> {
  if (entries.length === 0) return 0;
  const safeOrgId = requireOrgId(orgId);

  let saved = 0;
  for (const e of entries) {
    try {
      await saveMemory({
        orgId: safeOrgId,
        userId,
        memoryType: e.memoryType,
        content: e.content,
        layer: e.layer,
        tags: e.tags,
        importance: e.importance,
        sourceThreadId: e.sourceThreadId,
      });
      saved++;
    } catch {
      /* 单条失败不阻塞其它 */
    }
  }
  return saved;
}

export async function listMemories(
  userId: string,
  orgId: string,
  opts?: {
    layer?: number;
    memoryType?: string;
    search?: string;
    limit?: number;
    offset?: number;
    /** 默认 false：只返回当前生效记忆 */
    includeSuperseded?: boolean;
  },
): Promise<{ items: MemoryEntry[]; total: number }> {
  const safeOrgId = requireOrgId(orgId);
  const where: Record<string, unknown> = { userId, orgId: safeOrgId };
  if (!opts?.includeSuperseded) {
    where.effectiveTo = null;
  }
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
      orderBy: [
        { layer: "asc" },
        { importance: "desc" },
        { effectiveFrom: "desc" },
      ],
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    db.userMemory.count({ where: where as never }),
  ]);

  return { items: items as MemoryEntry[], total };
}

export async function getMemoryById(
  userId: string,
  orgId: string,
  id: string,
): Promise<MemoryEntry | null> {
  const m = await db.userMemory.findFirst({
    where: { id, userId, orgId: requireOrgId(orgId) },
  });
  return m as MemoryEntry | null;
}

export async function updateMemory(
  userId: string,
  orgId: string,
  id: string,
  data: {
    content?: string;
    memoryType?: MemoryType;
    layer?: number;
    tags?: string;
    importance?: number;
  },
): Promise<MemoryEntry> {
  const owned = await db.userMemory.findFirst({
    where: { id, userId, orgId: requireOrgId(orgId) },
    select: { id: true },
  });
  if (!owned) throw new Error("记忆不存在或跨组织");

  let embedding: number[] | undefined;
  if (data.content) {
    try {
      embedding = await generateEmbedding(data.content);
    } catch {
      /* ignore */
    }
  }

  const updated = await db.userMemory.update({
    where: { id: owned.id },
    data: {
      ...data,
      ...(embedding ? { embedding } : {}),
    },
  });
  return updated as MemoryEntry;
}

export async function deleteMemory(
  userId: string,
  orgId: string,
  id: string,
): Promise<void> {
  const owned = await db.userMemory.findFirst({
    where: { id, userId, orgId: requireOrgId(orgId) },
    select: { id: true },
  });
  if (!owned) throw new Error("记忆不存在或跨组织");
  await db.userMemory.delete({ where: { id: owned.id } });
}

export async function backfillEmbeddings(
  userId: string,
  orgId: string,
): Promise<number> {
  const noEmbed = await db.userMemory.findMany({
    where: {
      userId,
      orgId: requireOrgId(orgId),
      embedding: { equals: Prisma.JsonNull },
    },
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
    } catch {
      break;
    }
  }
  return count;
}

/** 纯函数：相似度接近时偏新（供测试与 recall 复用） */
export function preferRecentOnSimilarityTie<
  T extends { similarity: number; effectiveFrom: Date | string },
>(
  a: T,
  b: T,
  epsilon = 0.02,
): number {
  const simDiff = b.similarity - a.similarity;
  if (Math.abs(simDiff) < epsilon) {
    const ta = new Date(a.effectiveFrom).getTime();
    const tb = new Date(b.effectiveFrom).getTime();
    return tb - ta;
  }
  return simDiff;
}
