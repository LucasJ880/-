/**
 * Phase 3B-A Commit 6A：Retry 幂等占位状态机
 *
 * 键：assistant-run-retry:{oldRunId}:{attempt}
 * 状态：RESERVED → STARTED → COMPLETED | FAILED
 * 存储：ApprovalDecisionIdempotency.resultJson
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type RetrySlotStatus =
  | "RESERVED"
  | "STARTED"
  | "COMPLETED"
  | "FAILED";

export type RetrySlotPayload = {
  status: RetrySlotStatus;
  retryAttempt: number;
  oldRunId: string;
  newRunId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export function buildRetryIdempotencyKey(
  oldRunId: string,
  attempt: number,
): string {
  return `assistant-run-retry:${oldRunId}:${attempt}`;
}

export function parseRetrySlot(raw: unknown): RetrySlotPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (
    status !== "RESERVED" &&
    status !== "STARTED" &&
    status !== "COMPLETED" &&
    status !== "FAILED"
  ) {
    return null;
  }
  if (typeof o.oldRunId !== "string" || typeof o.retryAttempt !== "number") {
    return null;
  }
  return {
    status,
    oldRunId: o.oldRunId,
    retryAttempt: o.retryAttempt,
    newRunId: typeof o.newRunId === "string" ? o.newRunId : undefined,
    userMessageId:
      typeof o.userMessageId === "string" ? o.userMessageId : undefined,
    assistantMessageId:
      typeof o.assistantMessageId === "string"
        ? o.assistantMessageId
        : undefined,
    errorCode: typeof o.errorCode === "string" ? o.errorCode : undefined,
    errorMessage:
      typeof o.errorMessage === "string" ? o.errorMessage : undefined,
  };
}

/** 可注入存储（单测模拟并发） */
export type RetrySlotStore = {
  tryCreate: (input: {
    orgId: string;
    idempotencyKey: string;
    userId: string;
    oldRunId: string;
    payload: RetrySlotPayload;
  }) => Promise<"created" | "conflict">;
  get: (orgId: string, idempotencyKey: string) => Promise<RetrySlotPayload | null>;
  casUpdate: (input: {
    orgId: string;
    idempotencyKey: string;
    fromStatus: RetrySlotStatus;
    payload: RetrySlotPayload;
  }) => Promise<boolean>;
};

export function createMemoryRetrySlotStore(): RetrySlotStore & {
  rows: Map<string, RetrySlotPayload>;
} {
  const rows = new Map<string, RetrySlotPayload>();
  const keyOf = (orgId: string, k: string) => `${orgId}::${k}`;
  return {
    rows,
    async tryCreate(input) {
      const k = keyOf(input.orgId, input.idempotencyKey);
      if (rows.has(k)) return "conflict";
      rows.set(k, { ...input.payload });
      return "created";
    },
    async get(orgId, idempotencyKey) {
      const v = rows.get(keyOf(orgId, idempotencyKey));
      return v ? { ...v } : null;
    },
    async casUpdate(input) {
      const k = keyOf(input.orgId, input.idempotencyKey);
      const cur = rows.get(k);
      if (!cur || cur.status !== input.fromStatus) return false;
      rows.set(k, { ...input.payload });
      return true;
    },
  };
}

export const prismaRetrySlotStore: RetrySlotStore = {
  async tryCreate(input) {
    try {
      await db.approvalDecisionIdempotency.create({
        data: {
          orgId: input.orgId,
          idempotencyKey: input.idempotencyKey,
          approvalKey: `assistant-run-retry:${input.oldRunId}`,
          action: "retry",
          userId: input.userId,
          resultJson: input.payload as object,
        },
      });
      return "created";
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return "conflict";
      }
      throw err;
    }
  },
  async get(orgId, idempotencyKey) {
    const row = await db.approvalDecisionIdempotency.findUnique({
      where: { orgId_idempotencyKey: { orgId, idempotencyKey } },
    });
    return parseRetrySlot(row?.resultJson);
  },
  async casUpdate(input) {
    const updated = await db.approvalDecisionIdempotency.updateMany({
      where: {
        orgId: input.orgId,
        idempotencyKey: input.idempotencyKey,
        resultJson: {
          path: ["status"],
          equals: input.fromStatus,
        },
      },
      data: {
        resultJson: input.payload as Prisma.InputJsonValue,
      },
    });
    return updated.count === 1;
  },
};

export type ReserveRetryResult =
  | { kind: "acquired"; payload: RetrySlotPayload }
  | { kind: "completed"; payload: RetrySlotPayload }
  | { kind: "in_progress"; payload: RetrySlotPayload }
  | { kind: "reclaimed"; payload: RetrySlotPayload };

/**
 * 任何 Dispatch / 消息写入之前调用。
 * 第一请求 create RESERVED；冲突则读状态，不启动第二次。
 * FAILED 可通过 CAS 回收同一 attempt。
 */
export async function reserveRetrySlot(
  store: RetrySlotStore,
  input: {
    orgId: string;
    userId: string;
    oldRunId: string;
    retryAttempt: number;
    idempotencyKey: string;
  },
): Promise<ReserveRetryResult> {
  const reserved: RetrySlotPayload = {
    status: "RESERVED",
    oldRunId: input.oldRunId,
    retryAttempt: input.retryAttempt,
  };

  const created = await store.tryCreate({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    userId: input.userId,
    oldRunId: input.oldRunId,
    payload: reserved,
  });

  if (created === "created") {
    return { kind: "acquired", payload: reserved };
  }

  const existing = await store.get(input.orgId, input.idempotencyKey);
  if (!existing) {
    // 极罕见：冲突后立刻被删；再试一次 create
    const again = await store.tryCreate({
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      oldRunId: input.oldRunId,
      payload: reserved,
    });
    if (again === "created") {
      return { kind: "acquired", payload: reserved };
    }
    const againExisting = await store.get(input.orgId, input.idempotencyKey);
    if (againExisting?.status === "COMPLETED" && againExisting.newRunId) {
      return { kind: "completed", payload: againExisting };
    }
    return {
      kind: "in_progress",
      payload: againExisting ?? reserved,
    };
  }

  if (existing.status === "COMPLETED" && existing.newRunId) {
    return { kind: "completed", payload: existing };
  }

  if (existing.status === "FAILED") {
    const ok = await store.casUpdate({
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      fromStatus: "FAILED",
      payload: reserved,
    });
    if (ok) {
      return { kind: "reclaimed", payload: reserved };
    }
    const after = await store.get(input.orgId, input.idempotencyKey);
    if (after?.status === "COMPLETED" && after.newRunId) {
      return { kind: "completed", payload: after };
    }
    return { kind: "in_progress", payload: after ?? existing };
  }

  // RESERVED / STARTED：并发请求不得再执行
  return { kind: "in_progress", payload: existing };
}

export async function markRetrySlotStarted(
  store: RetrySlotStore,
  input: {
    orgId: string;
    idempotencyKey: string;
    fromStatus: RetrySlotStatus;
    payload: RetrySlotPayload;
  },
): Promise<boolean> {
  return store.casUpdate({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    fromStatus: input.fromStatus,
    payload: { ...input.payload, status: "STARTED" },
  });
}

export async function markRetrySlotCompleted(
  store: RetrySlotStore,
  input: {
    orgId: string;
    idempotencyKey: string;
    payload: RetrySlotPayload;
  },
): Promise<boolean> {
  // STARTED → COMPLETED；若仍为 RESERVED（未写 STARTED）也允许完成
  const fromStarted = await store.casUpdate({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    fromStatus: "STARTED",
    payload: { ...input.payload, status: "COMPLETED" },
  });
  if (fromStarted) return true;
  return store.casUpdate({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    fromStatus: "RESERVED",
    payload: { ...input.payload, status: "COMPLETED" },
  });
}

export async function markRetrySlotFailed(
  store: RetrySlotStore,
  input: {
    orgId: string;
    idempotencyKey: string;
    payload: RetrySlotPayload;
    errorCode: string;
    errorMessage?: string;
  },
): Promise<boolean> {
  const failed: RetrySlotPayload = {
    ...input.payload,
    status: "FAILED",
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  for (const from of ["STARTED", "RESERVED"] as RetrySlotStatus[]) {
    const ok = await store.casUpdate({
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      fromStatus: from,
      payload: failed,
    });
    if (ok) return true;
  }
  return false;
}
