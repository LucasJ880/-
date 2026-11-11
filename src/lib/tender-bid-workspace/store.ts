/**
 * TI-4a 投标工作区存取（BidIntelligenceRoom.summaryJson.bidWorkspace；零 schema）
 *
 * 保存 = 事务里锁住该项目的情报室行 → 读出 JSON → 只替换自己的键 → 写回 → 写审计。
 * 同一 JSON 位里其它功能的内容原样保留；分块保存按块合并；并发保存不丢改动。
 * 这里只有非财务内容（见 contract.ts 文件头）。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { BID_WORKSPACE_KEY, blocksIn, mergeWorkspace, readStoredWorkspace, type SaveWorkspaceRequest, type StoredWorkspace } from "./contract";
import type { WorkspaceContext } from "./workspace-view";

export const BID_WORKSPACE_AUDIT_ACTION = "tender.bid_workspace.update" as const;
export const BID_WORKSPACE_AUDIT_TARGET = "tender_bid_workspace" as const;

export async function loadWorkspace(projectId: string): Promise<StoredWorkspace | null> {
  const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } });
  return readStoredWorkspace(room?.summaryJson);
}

/** 读取结果要用到的项目事实：截标时间、我方名称、文件数、已报价的供应商行数。 */
export async function loadWorkspaceContext(projectId: string, orgId: string, now: Date): Promise<WorkspaceContext> {
  const [project, org, documentCount, quotedSupplierCount] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { closeDate: true, dueDate: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    db.projectDocument.count({ where: { projectId } }),
    db.inquiryItem.count({ where: { inquiry: { projectId }, status: "quoted" } }),
  ]);
  const closing = project?.closeDate ?? project?.dueDate ?? null;
  return {
    now,
    closingAtIso: closing ? closing.toISOString() : null,
    ownNames: org?.name ? [org.name] : [],
    documentCount,
    quotedSupplierCount,
  };
}

async function ensureRoom(projectId: string, orgId: string): Promise<void> {
  try {
    await db.bidIntelligenceRoom.upsert({ where: { projectId }, create: { orgId, projectId }, update: {}, select: { id: true } });
  } catch (err) {
    // 两个请求同时首次建行：另一个已经建好，继续即可
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
}

/**
 * 分块保存。orgId 与 userId 必须来自服务端（项目记录与登录会话），不取自请求内容。
 */
export async function saveWorkspaceBlocks(input: {
  projectId: string;
  orgId: string;
  userId: string;
  request: SaveWorkspaceRequest;
  now?: Date;
}): Promise<StoredWorkspace> {
  const now = input.now ?? new Date();
  await ensureRoom(input.projectId, input.orgId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BidIntelligenceRoom" WHERE "projectId" = ${input.projectId} FOR UPDATE`;
    const room = await tx.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: input.projectId }, select: { id: true, summaryJson: true } });
    const sj = ((room.summaryJson as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const next = mergeWorkspace(readStoredWorkspace(sj), input.request, input.userId, now);
    await tx.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: { summaryJson: { ...sj, [BID_WORKSPACE_KEY]: next } as unknown as Prisma.InputJsonValue },
    });
    await writeAuditLog(tx, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      action: BID_WORKSPACE_AUDIT_ACTION,
      targetType: BID_WORKSPACE_AUDIT_TARGET,
      targetId: room.id,
      // 只记改了哪几块与规模，不记内容、不记任何金额
      afterData: { blocks: blocksIn(input.request), lineCount: next.priceSchedule.lines.length, addendaCount: next.addenda.length, hasDocumentHolders: !!next.documentHolders },
    });
    return next;
  });
}
