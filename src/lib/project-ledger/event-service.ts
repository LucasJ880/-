/**
 * ProjectEvent canonical append service — 全库唯一权威写入口
 *
 * 契约（#96 §5.6，Final Contract 冻结）：
 *   eventKey 幂等短路 → max(seq)+1 → create → P2002 分流
 *   （eventKey 命中 = 并发同动作 → 返回既有行；seq 命中 = 并发占号 → 有界重试）
 *   → PROJECT_EVENT_SEQUENCE_MAX_RETRIES=8 耗尽 → THROW → 业务事务整体回滚。
 *
 * 禁止：catch→log→continue、return null、best-effort、fire-and-forget。
 * 业务代码不得直接 prisma.projectEvent.create —— 一律经本服务。
 *
 * 实现说明（Postgres 语义）：事务内约束冲突会使整个事务进入 aborted 态，
 * 因此每次尝试包在 SAVEPOINT 中；P2002 时 ROLLBACK TO SAVEPOINT 后重试，
 * 事务保持健康。这是冻结契约「P2002 → bounded retry」在 Postgres 下的
 * 忠实实现，不改变任何语义。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { lockProjectHistoryAnchorShared } from "./history-anchor";
import {
  LEDGER_ACTOR_TYPES,
  LedgerContractError,
  LedgerSeqContentionError,
  LedgerTenantError,
  type AppendProjectEventInput,
  type AppendProjectEventResult,
} from "./types";

export const PROJECT_EVENT_SEQUENCE_MAX_RETRIES = 8;

const SAVEPOINT = "project_ledger_append";

function isP2002(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

/** P2002 meta.target 分类：命中的是 eventKey 幂等键还是 seq 顺序键 */
function p2002Target(e: Prisma.PrismaClientKnownRequestError): {
  eventKey: boolean;
  seq: boolean;
} {
  const target = e.meta?.target;
  const joined = Array.isArray(target)
    ? target.join(",")
    : String(target ?? "");
  return {
    eventKey: joined.includes("eventKey"),
    seq: joined.includes("seq"),
  };
}

export async function appendProjectEvent(
  input: AppendProjectEventInput,
): Promise<AppendProjectEventResult> {
  const { tx } = input;
  if (!tx) {
    throw new LedgerContractError(
      "appendProjectEvent requires a transaction client (authoritative atomicity)",
    );
  }
  if (!input.orgId || !input.projectId) {
    throw new LedgerContractError("orgId and projectId are required");
  }
  if (!input.eventType || !input.eventKey || !input.title) {
    throw new LedgerContractError("eventType, eventKey and title are required");
  }
  if (!LEDGER_ACTOR_TYPES.includes(input.actor.actorType)) {
    throw new LedgerContractError(
      `invalid actorType: ${String(input.actor.actorType)}`,
    );
  }
  if (!(input.occurredAt instanceof Date) || isNaN(input.occurredAt.getTime())) {
    throw new LedgerContractError("occurredAt must be a valid Date");
  }

  // 租户闸 + 授权锚锁（T3.5）：项目必须存在且属于该 org；同时对 Project 行取
  // FOR KEY SHARE，与 hard delete 的 FOR UPDATE 互斥，关闭 append↔delete 的 TOCTOU 窗口。
  // 不泄露跨 org 存在性（统一 not-found 语义）。多个 writer 之间 FKS 兼容 → 保持并发。
  const anchorLocked = await lockProjectHistoryAnchorShared(
    tx,
    input.orgId,
    input.projectId,
  );
  if (!anchorLocked) {
    throw new LedgerTenantError();
  }

  // 1. eventKey 幂等短路
  const existing = await tx.projectEvent.findUnique({
    where: {
      projectId_eventKey: {
        projectId: input.projectId,
        eventKey: input.eventKey,
      },
    },
    select: { id: true, projectId: true, seq: true, eventKey: true, eventType: true, orgId: true },
  });
  if (existing) {
    if (existing.orgId !== input.orgId) {
      throw new LedgerTenantError();
    }
    return {
      event: {
        id: existing.id,
        projectId: existing.projectId,
        seq: existing.seq,
        eventKey: existing.eventKey,
        eventType: existing.eventType,
      },
      created: false,
    };
  }

  const maxRetries = input.maxSeqRetries ?? PROJECT_EVENT_SEQUENCE_MAX_RETRIES;

  for (let attempt = 0; ; attempt++) {
    // 2. max(seq) + 1
    const agg = await tx.projectEvent.aggregate({
      where: { projectId: input.projectId },
      _max: { seq: true },
    });
    const seq = (agg._max.seq ?? 0) + 1;

    // 3. create（SAVEPOINT 保护：冲突不毒化外层业务事务）
    await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
    try {
      const created = await tx.projectEvent.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          seq,
          eventKey: input.eventKey,
          occurredAt: input.occurredAt,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId ?? null,
          eventType: input.eventType,
          stage: input.stage ?? null,
          title: input.title,
          summary: input.summary ?? null,
          result: input.result ?? null,
          payload: input.payload ?? Prisma.JsonNull,
          refs: input.refs ?? Prisma.JsonNull,
          relatedDocumentId: input.relatedDocumentId ?? null,
          relatedCostId: input.relatedCostId ?? null,
          sourceRef: input.sourceRef ?? null,
          traceId: input.traceId ?? null,
          correctionOfEventId: input.correctionOfEventId ?? null,
        },
        select: { id: true, projectId: true, seq: true, eventKey: true, eventType: true },
      });

      // 参与者行与事件同事务（仅显式提供时写入；记账人不重复落 junction）
      if (input.actors && input.actors.length > 0) {
        const seen = new Set<string>();
        for (const a of input.actors) {
          if (!a.actorKey || seen.has(a.actorKey)) continue;
          seen.add(a.actorKey);
          await tx.projectEventActor.create({
            data: {
              orgId: input.orgId,
              eventId: created.id,
              actorKey: a.actorKey,
              userId: a.userId ?? null,
              role: a.role ?? "participant",
            },
          });
        }
      }

      return { event: created, created: true };
    } catch (e) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      if (!isP2002(e)) {
        throw e;
      }
      const hit = p2002Target(e);
      if (hit.eventKey) {
        // 4a. 并发同 eventKey：另一事务已提交同动作 → 幂等返回既有行
        const row = await tx.projectEvent.findUnique({
          where: {
            projectId_eventKey: {
              projectId: input.projectId,
              eventKey: input.eventKey,
            },
          },
          select: { id: true, projectId: true, seq: true, eventKey: true, eventType: true },
        });
        if (row) {
          logger.info("project_event_append_conflict", {
            kind: "event_key_concurrent_duplicate",
            projectId: input.projectId,
            eventType: input.eventType,
          });
          return { event: row, created: false };
        }
        // 冲突行不可见（对方未提交）：按占号竞争走重试
      }
      // 4b. seq 占号竞争：有界重试
      if (attempt >= maxRetries) {
        logger.error("project_event_append_failure", {
          kind: "seq_contention_exhausted",
          projectId: input.projectId,
          eventType: input.eventType,
          attempts: attempt + 1,
        });
        // 5. THROW → 外层业务事务整体回滚（authoritative，绝不吞错）
        throw new LedgerSeqContentionError(attempt + 1);
      }
      logger.warn("project_event_append_retry", {
        projectId: input.projectId,
        eventType: input.eventType,
        attempt: attempt + 1,
        seqTried: seq,
        target: hit,
      });
    }
  }
}

export interface ListProjectEventsInput {
  orgId: string;
  projectId: string;
  /** 返回 seq < cursor 的事件（向历史翻页） */
  cursor?: number;
  limit?: number;
}

/** 最小只读服务：seq DESC 稳定排序 + cursor 分页；无 update/delete API */
export async function listProjectEvents(input: ListProjectEventsInput) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId },
    select: { id: true },
  });
  if (!project) {
    throw new LedgerTenantError();
  }
  const rows = await db.projectEvent.findMany({
    where: {
      projectId: input.projectId,
      orgId: input.orgId,
      ...(input.cursor !== undefined ? { seq: { lt: input.cursor } } : {}),
    },
    orderBy: { seq: "desc" },
    take: limit + 1,
  });
  const events = rows.slice(0, limit);
  return {
    events,
    nextCursor: rows.length > limit ? events[events.length - 1]!.seq : null,
  };
}
